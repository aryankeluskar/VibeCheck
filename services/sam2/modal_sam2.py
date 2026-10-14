from pathlib import Path
import modal

MODEL_TYPE = "facebook/sam2-hiera-large"
SAM2_GIT_SHA = "c2ec8e14a185632b0a5d8b161928ceb50197eddc"

image = (
    modal.Image.debian_slim(python_version="3.10")
    .apt_install("git", "wget", "python3-opencv", "ffmpeg")
    .uv_pip_install(
        "torch~=2.4.1",
        "torchvision==0.19.1",
        "opencv-python==4.10.0.84",
        "pycocotools~=2.0.8",
        "onnxruntime==1.19.2",
        "onnx==1.17.0",
        "huggingface_hub==0.25.2",
        "ffmpeg-python==0.2.0",
        "fastapi",
        f"git+https://github.com/facebookresearch/sam2.git@{SAM2_GIT_SHA}",
    )
)

app = modal.App("jigglewiggle-sam2", image=image)

cache_vol = modal.Volume.from_name("hf-hub-cache", create_if_missing=True)
cache_dir = "/cache"

# Parallel processing config
# Modal allows max 10 concurrent GPUs
# Reserve 2 (orchestrator + buffer), use up to 8 for chunks
MAX_PARALLEL_CHUNKS = 8


@app.cls(
    image=image.env({"HF_HUB_CACHE": cache_dir}),
    volumes={cache_dir: cache_vol},
    gpu="A100",
    scaledown_window=300,
)
class SAM2Model:
    @modal.enter()
    def load_model(self):
        from sam2.sam2_video_predictor import SAM2VideoPredictor

        self.video_predictor = SAM2VideoPredictor.from_pretrained(MODEL_TYPE)
        print("SAM2 model loaded")

    @modal.method()
    def segment_chunk(self, frame_jpegs: list[bytes], width: int, height: int) -> list[bytes]:
        """Process a chunk of frames, return PNG mask bytes for each frame."""
        import io
        import tempfile
        import time

        import numpy as np
        import torch
        from PIL import Image

        t0 = time.time()

        # Write frames to temp dir for SAM2
        tmp_dir = Path(tempfile.mkdtemp())
        frames_dir = tmp_dir / "frames"
        frames_dir.mkdir()

        for i, jpg_bytes in enumerate(frame_jpegs):
            (frames_dir / f"{i:05d}.jpg").write_bytes(jpg_bytes)

        points = np.array([[width // 2, height // 2]], dtype=np.float32)
        labels = np.array([1], np.int32)

        with (
            torch.inference_mode(),
            torch.autocast("cuda", dtype=torch.bfloat16),
        ):
            inference_state = self.video_predictor.init_state(
                video_path=str(frames_dir)
            )

            self.video_predictor.add_new_points_or_box(
                inference_state=inference_state,
                frame_idx=0,
                obj_id=1,
                points=points,
                labels=labels,
            )

            video_segments = {}
            for out_frame_idx, out_obj_ids, out_mask_logits in self.video_predictor.propagate_in_video(
                inference_state
            ):
                video_segments[out_frame_idx] = {
                    out_obj_id: (out_mask_logits[i] > 0.0).cpu().numpy()
                    for i, out_obj_id in enumerate(out_obj_ids)
                }

        # Render masks as PNG bytes
        mask_pngs = []
        for frame_idx in range(len(frame_jpegs)):
            mask_img = np.zeros((height, width, 3), dtype=np.uint8)
            if frame_idx in video_segments:
                for obj_id, mask in video_segments[frame_idx].items():
                    mask_2d = mask.squeeze()
                    mask_img[mask_2d] = [255, 255, 255]

            buf = io.BytesIO()
            Image.fromarray(mask_img).save(buf, format="PNG")
            mask_pngs.append(buf.getvalue())

        print(f"Chunk: {len(frame_jpegs)} frames in {time.time() - t0:.1f}s")
        return mask_pngs

    @modal.fastapi_endpoint(method="POST", docs=True)
    def segment(self, data: dict):
        """Accept base64 video, split into chunks, process in parallel, return mask video."""
        import base64
        import subprocess
        import tempfile
        import time

        import ffmpeg
        from PIL import Image

        t0 = time.time()

        video_b64 = data.get("video_base64", "")
        if not video_b64:
            return {"error": "No video_base64 provided"}

        if "," in video_b64:
            video_b64 = video_b64.split(",", 1)[1]

        video_bytes = base64.b64decode(video_b64)
        print(f"Received video: {len(video_bytes)} bytes")

        tmp_dir = Path(tempfile.mkdtemp())
        input_path = tmp_dir / "input.mp4"
        input_path.write_bytes(video_bytes)

        # Probe video
        probe = ffmpeg.probe(str(input_path))
        video_stream = next(
            s for s in probe["streams"] if s["codec_type"] == "video"
        )
        fps_parts = video_stream["r_frame_rate"].split("/")
        original_fps = int(fps_parts[0]) / int(fps_parts[1])

        # Extract all frames at original fps
        frames_dir = tmp_dir / "frames"
        frames_dir.mkdir()
        ffmpeg.input(str(input_path)).output(
            f"{frames_dir}/%05d.jpg",
            qscale=2,
            start_number=0,
        ).run(quiet=True)

        frame_paths = sorted(
            [p for p in frames_dir.iterdir() if p.suffix in [".jpg", ".jpeg"]],
            key=lambda p: int(p.stem),
        )

        if not frame_paths:
            return {"error": "No frames extracted from video"}

        # Get dimensions
        first_img = Image.open(frame_paths[0])
        width, height = first_img.size

        # Read all frame bytes
        all_frame_bytes = [p.read_bytes() for p in frame_paths]
        num_frames = len(all_frame_bytes)

        print(f"Extracted {num_frames} frames at {original_fps:.1f}fps")

        # Split into chunks — dynamic size to stay within GPU limit
        import math
        num_chunks = min(MAX_PARALLEL_CHUNKS, num_frames)
        frames_per_chunk = math.ceil(num_frames / num_chunks)
        chunks = []
        for i in range(0, num_frames, frames_per_chunk):
            chunks.append(all_frame_bytes[i:i + frames_per_chunk])

        print(f"Split into {len(chunks)} chunks for parallel processing")

        # Process chunks in parallel using .map()
        if len(chunks) == 1:
            # Single chunk — just run directly (no overhead)
            all_mask_pngs = self.segment_chunk.local(chunks[0], width, height)
        else:
            # Parallel across multiple containers
            chunk_results = list(
                self.segment_chunk.map(
                    chunks,
                    kwargs=dict(width=width, height=height),
                )
            )
            # Flatten results
            all_mask_pngs = []
            for chunk_masks in chunk_results:
                all_mask_pngs.extend(chunk_masks)

        # Write mask PNGs to disk
        mask_dir = tmp_dir / "masks"
        mask_dir.mkdir()
        for i, png_bytes in enumerate(all_mask_pngs):
            (mask_dir / f"{i:05d}.png").write_bytes(png_bytes)

        # Encode to video
        output_path = tmp_dir / "mask.mp4"
        cmd = [
            "ffmpeg", "-y",
            "-framerate", str(original_fps),
            "-i", f"{mask_dir}/%05d.png",
            "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2",
            "-c:v", "libx264",
            "-pix_fmt", "yuv420p",
            str(output_path),
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            print(f"ffmpeg stderr: {result.stderr}")
            raise RuntimeError(f"ffmpeg failed: {result.stderr[-500:]}")

        result_bytes = output_path.read_bytes()
        result_b64 = base64.b64encode(result_bytes).decode("utf-8")

        total_time = time.time() - t0
        print(f"Total: {total_time:.1f}s, {num_frames} frames, {len(chunks)} chunks, output: {len(result_bytes)} bytes")

        return {
            "mask_video_base64": result_b64,
            "num_frames": num_frames,
            "fps": original_fps,
            "original_fps": original_fps,
            "chunks": len(chunks),
            "processing_time": round(total_time, 1),
        }
