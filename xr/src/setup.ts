/**
 * 2D setup screen shown before the immersive session. Quest Browser only
 * grants camera access outside XR, so permission is requested here.
 */

import { CameraFacing, CameraUtils, type World } from '@iwsdk/core';
import { beaconInfo } from './beacon.js';
import { session, type RefLayout } from './session.js';

type LibraryVideo = { id: string; title: string; mode: 'dance' | 'gym' };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export function setupScreen(world: World) {
  const videoSelect = $<HTMLSelectElement>('video');
  const cameraSelect = $<HTMLSelectElement>('camera');
  const allowBtn = $<HTMLButtonElement>('allow-camera');
  const enterBtn = $<HTMLButtonElement>('enter');
  const status = $<HTMLDivElement>('status');
  const progress = $<HTMLDivElement>('ref-progress');
  const params = new URLSearchParams(location.search);

  let library: LibraryVideo[] = [];
  let refReady = false;
  let cameraReady = false;
  let loadToken = 0;

  const say = (msg: string) => {
    status.textContent = msg;
    beaconInfo.setupStatus = msg;
  };
  const refresh = () => (enterBtn.disabled = !(refReady && cameraReady));

  // Segmented toggles
  const bindSeg = (rootId: string, attr: string, onPick: (v: string) => void) => {
    const root = $(rootId);
    root.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
      b.addEventListener('click', () => {
        root.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        onPick(b.dataset[attr]!);
      });
    });
  };
  const setSeg = (rootId: string, attr: string, value: string) => {
    $(rootId)
      .querySelectorAll<HTMLButtonElement>('button')
      .forEach((x) => x.setAttribute('aria-pressed', String(x.dataset[attr] === value)));
  };
  bindSeg('layout', 'layout', (v) => (session.layout = v as RefLayout));
  bindSeg('sees', 'sees', (v) => (session.engine.cameraSeesMirror = v === 'mirror'));
  const initialLayout = params.get('layout');
  if (initialLayout === 'left' || initialLayout === 'top' || initialLayout === 'right') {
    session.layout = initialLayout;
    setSeg('layout', 'layout', initialLayout);
  }

  // Reference video: create the element, then load (or analyze) its pose timeline
  const loadReference = async (id: string) => {
    const token = ++loadToken;
    refReady = false;
    refresh();
    const meta = library.find((v) => v.id === id);
    session.title = meta?.title ?? id;
    session.engine.mode = meta?.mode ?? 'dance';

    session.reference?.pause();
    progress.style.width = '0%';
    try {
      // Download the clip once: seeks for analysis become local and the
      // headset never buffers mid-routine.
      say('Downloading reference video…');
      const res = await fetch(`/api/video/${id}`);
      if (!res.ok) throw new Error(`video ${res.status}`);
      const src = URL.createObjectURL(await res.blob());
      if (token !== loadToken) return;

      const video = document.createElement('video');
      video.playsInline = true;
      video.preload = 'auto';
      video.src = src;
      session.reference = video;

      say('Loading reference poses…');
      await session.engine.loadReference(id, src, (pct) => {
        if (token === loadToken) progress.style.width = `${pct}%`;
      });
      if (token !== loadToken) return;
      progress.style.width = '100%';
      refReady = true;
      say(cameraReady ? 'Ready. Put on the headset and enter.' : 'Reference ready. Now allow the camera.');
    } catch (err) {
      if (token === loadToken) say(`Could not analyze that video: ${err instanceof Error ? err.message : err}`);
    }
    refresh();
  };

  fetch('/api/library')
    .then((r) => r.json())
    .then((data: { videos: LibraryVideo[] }) => {
      library = data.videos ?? [];
      videoSelect.innerHTML = '';
      if (library.length === 0) {
        videoSelect.innerHTML = '<option>Library is empty. Add a video in the 2D app.</option>';
        return;
      }
      for (const v of library) {
        const opt = document.createElement('option');
        opt.value = v.id;
        opt.textContent = `${v.mode === 'gym' ? 'GYM' : 'DANCE'} · ${v.title || v.id}`;
        videoSelect.appendChild(opt);
      }
      const wanted = params.get('v');
      if (wanted && library.some((v) => v.id === wanted)) videoSelect.value = wanted;
      loadReference(videoSelect.value);
    })
    .catch(() => say('Could not load the video library.'));
  videoSelect.addEventListener('change', () => loadReference(videoSelect.value));

  // Camera: IWSDK's CameraUtils requests permission and tags Quest passthrough
  // cameras ("camera 1/2, facing back") as Back. The stream itself is opened
  // directly so it doesn't depend on the ECS frame loop running.
  let stream: MediaStream | null = null;
  const startCamera = async (deviceId: string) => {
    cameraReady = false;
    refresh();
    stream?.getTracks().forEach((t) => t.stop());
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: { exact: deviceId },
          width: { ideal: 1280 },
          height: { ideal: 960 },
          frameRate: { ideal: 30 },
        },
        audio: false,
      });
    } catch (err) {
      say(`Camera failed to start: ${err instanceof Error ? err.message : err}`);
      return;
    }
    const video = document.createElement('video');
    video.playsInline = true;
    video.muted = true;
    video.srcObject = stream;
    await video.play();
    session.camera = video;
    cameraReady = true;
    say(refReady ? 'Ready. Put on the headset and enter.' : 'Camera ready. Loading reference…');
    refresh();
  };

  allowBtn.addEventListener('click', async () => {
    try {
      const devices = await CameraUtils.getDevices(true);
      beaconInfo.cameras = devices.map((d) => ({ label: d.label, facing: d.facing }));
      cameraSelect.innerHTML = '';
      for (const d of devices) {
        const opt = document.createElement('option');
        opt.value = d.deviceId;
        opt.textContent = `${d.label || 'Camera'}${d.facing === CameraFacing.Back ? ' (passthrough)' : ''}`;
        cameraSelect.appendChild(opt);
      }
      cameraSelect.disabled = devices.length === 0;
      const back = CameraUtils.findByFacing(devices, CameraFacing.Back);
      const pick = back ?? devices[0];
      if (!pick) {
        say('No camera found.');
        return;
      }
      cameraSelect.value = pick.deviceId;
      // A back camera on a headset looks at the mirror; anything else faces the user.
      session.engine.cameraSeesMirror = !!back;
      setSeg('sees', 'sees', back ? 'mirror' : 'direct');
      allowBtn.textContent = 'Camera allowed';
      allowBtn.disabled = true;
      await startCamera(pick.deviceId);
    } catch {
      say('Camera permission was denied. Allow it in the browser settings and reload.');
    }
  });
  cameraSelect.addEventListener('change', () => startCamera(cameraSelect.value));

  enterBtn.addEventListener('click', async () => {
    if (!session.reference || !session.camera) return;
    enterBtn.disabled = true;
    say('Starting…');
    // Start playback inside the click so audio is allowed; pause until in XR.
    session.reference.play().then(() => session.reference?.pause()).catch(() => {});
    await session.engine.start(session.camera, session.reference, { lite: params.get('full') !== '1' });
    session.started = true;
    $('setup').classList.add('hidden');
    if (world.xrEnabled) world.launchXR();
    session.reference.currentTime = 0;
    session.reference.play().catch(() => {});
  });
}
