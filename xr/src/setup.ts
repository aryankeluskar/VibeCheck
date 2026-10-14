/**
 * 2D setup screen shown before the immersive session. Quest Browser only
 * grants camera access outside XR, so permission is requested here.
 */

import { CameraFacing, CameraUtils, VisibilityState, type World } from '@iwsdk/core';
import { beaconInfo } from './beacon.js';
import { session, type RefLayout } from './session.js';
import { cancelSpeech, unlockSpeech } from '../../app/shared/speech';

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
      // Loop: with hands only (no controllers) there is no way to restart a
      // finished clip, and a judge may put the headset on mid-routine.
      video.loop = true;
      video.src = src;
      const previous = session.reference;
      if (previous?.src.startsWith('blob:')) URL.revokeObjectURL(previous.src);
      session.reference = video;

      say('Loading reference poses…');
      await session.engine.loadReference(id, src, (pct) => {
        if (token === loadToken) progress.style.width = `${pct}%`;
      });
      if (token !== loadToken) return;
      progress.style.width = '100%';
      refReady = true;
      // Fetch + compile the live pose model now, while the user allows the camera.
      session.engine.preload({ lite: params.get('full') !== '1' }).catch(() => {});
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
      allowBtn.disabled = false;
      allowBtn.textContent = 'Allow camera';
      return;
    }
    // The headset sleeping between users can end the stream; ask again rather
    // than tracking a frozen frame.
    stream.getVideoTracks()[0]?.addEventListener('ended', () => {
      cameraReady = false;
      allowBtn.disabled = false;
      allowBtn.textContent = 'Allow camera';
      say('Camera stopped. Tap Allow camera again.');
      refresh();
    });
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

  // Each Enter tap is one attempt. Aborting (refused session, leaving XR)
  // bumps the counter so a pose model that finishes loading afterwards can't
  // start the music or coach behind the setup screen, and stops inference.
  let attempt = 0;
  const abortAttempt = (message: string) => {
    attempt++;
    session.started = false;
    session.reference?.pause();
    cancelSpeech();
    $('setup').classList.remove('hidden');
    say(message);
    refresh();
  };

  // Leaving XR (Meta button, headset off) brings the setup screen back so the
  // next person can tap Enter again without reloading.
  let wasImmersive = false;
  let pausedForHidden = false;
  world.visibilityState.subscribe((state) => {
    // Headset taken off / system menu: pause, and resume when it's back.
    const ref = session.reference;
    if (state === VisibilityState.Hidden && ref && !ref.paused) {
      ref.pause();
      pausedForHidden = true;
    } else if (state === VisibilityState.Visible && pausedForHidden) {
      pausedForHidden = false;
      ref?.play().catch(() => {});
    }
    if (state !== VisibilityState.NonImmersive) {
      wasImmersive = true;
      return;
    }
    pausedForHidden = false;
    if (!wasImmersive) return;
    wasImmersive = false;
    abortAttempt('Session ended. Tap Enter to go back in.');
  });

  /** Reports a session request the headset refused (permission denied, unsupported feature). */
  const watchSession = (mine: number) => {
    const startedAt = performance.now();
    const timer = setInterval(() => {
      if (world.session || mine !== attempt) {
        clearInterval(timer);
        return;
      }
      // Keep waiting while the request is pending: the headset may be showing
      // a permission prompt, and accepting it late must still work.
      if (world.sessionRequestPending || performance.now() - startedAt < 500) return;
      clearInterval(timer);
      console.error('[mirror-coach] XR session did not start');
      abortAttempt('Could not start mixed reality. Accept the headset permission prompt, then tap Enter again.');
    }, 250);
  };

  enterBtn.addEventListener('click', () => {
    const reference = session.reference;
    const camera = session.camera;
    if (!reference || !camera) return;
    const mine = ++attempt;
    enterBtn.disabled = true;
    say('Starting…');
    // WebXR only grants a session inside a live user gesture, and Chromium
    // expires that after a few seconds. Request the session first, while the
    // click is still fresh; the pose model loads afterwards (the HUD shows it).
    if (world.xrEnabled) {
      world.launchXR();
      watchSession(mine);
    }
    // Unlock the coach voice inside the click; later lines play outside any gesture.
    unlockSpeech();
    // Start playback inside the click so audio is allowed; pause until tracking starts.
    const unlock = reference.play().then(() => reference.pause()).catch(() => {});
    session.started = true;
    $('setup').classList.add('hidden');
    void (async () => {
      try {
        await session.engine.start(camera, reference, { lite: params.get('full') !== '1' });
      } catch (err) {
        if (mine === attempt) session.engine.setStatus('Pose model failed to load. Check Wi-Fi and re-enter.');
        console.error('[mirror-coach] pose model failed', err);
        return;
      }
      // Let the unlock play/pause settle first, or its pause() would stop the real start.
      await unlock;
      // Start the routine once the user can see it, not during the XR transition.
      for (let i = 0; i < 300 && world.xrEnabled && !world.session && mine === attempt; i++) {
        await new Promise((r) => setTimeout(r, 100));
      }
      if (mine !== attempt) return; // abandoned (refused session or left XR)
      reference.currentTime = 0;
      reference.play().catch(() => {});
    })();
  });
}
