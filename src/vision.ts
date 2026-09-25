import { FaceLandmarker, FilesetResolver, GestureRecognizer } from '@mediapipe/tasks-vision';

export type CameraMode = 'hand' | 'head';
export type Detection = { found: boolean; x?: number; y?: number; pinch?: boolean; openPalm?: boolean; label: string };
export type VisionSession = { stop: () => void };

export async function startVision(mode: CameraMode, video: HTMLVideoElement, onFrame: (result: Detection) => void, onError: (error: Error) => void): Promise<VisionSession> {
  const canvas = document.createElement('canvas');
  if (!canvas.getContext('webgl2') && !canvas.getContext('webgl'))
    throw new Error('WebGL is unavailable. Enable graphics acceleration in Chrome or Edge, or use keyboard/scanning.');
  const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' }, audio: false });
  video.srcObject = stream;
  let model: GestureRecognizer | FaceLandmarker | undefined;
  let frameId = 0;
  let stopped = false;
  try {
    await video.play();
    const files = await FilesetResolver.forVisionTasks('/models');
    if (mode === 'hand') {
      model = await GestureRecognizer.createFromOptions(files, {
        baseOptions: { modelAssetPath: '/models/gesture_recognizer.task', delegate: 'CPU' },
        runningMode: 'VIDEO', numHands: 1
      });
    } else {
      model = await FaceLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: '/models/face_landmarker.task', delegate: 'CPU' },
        runningMode: 'VIDEO', numFaces: 1
      });
    }
    let lastVideoTime = -1;
    let lastInference = 0;
    const loop = (time: number) => {
      if (stopped) return;
      // The models run synchronously. Limiting inference leaves time for the interface to render.
      try {
      if (video.readyState >= 2 && video.currentTime !== lastVideoTime && time - lastInference > 55) {
        lastVideoTime = video.currentTime;
        lastInference = time;
        if (mode === 'hand') {
          const r = (model as GestureRecognizer).recognizeForVideo(video, time);
          const points = r.landmarks[0];
          const gesture = r.gestures[0]?.[0];
          if (points) {
            const a = points[4], b = points[8], wrist = points[0], palm = points[9];
            const pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
            const palmSize = Math.max(.035, Math.hypot(wrist.x - palm.x, wrist.y - palm.y));
            onFrame({
              found: true, x: 1 - b.x, y: b.y,
              pinch: pinchDistance / palmSize < .35,
              openPalm: gesture?.categoryName === 'Open_Palm' && gesture.score > .65,
              label: pinchDistance / palmSize < .35 ? 'Pinch detected' : gesture?.categoryName || 'Hand tracked'
            });
          } else onFrame({ found: false, label: 'Show one hand to the camera' });
        } else {
          const r = (model as FaceLandmarker).detectForVideo(video, time);
          const nose = r.faceLandmarks[0]?.[1];
          if (nose) onFrame({ found: true, x: 1 - nose.x, y: nose.y, label: 'Face tracked' });
          else onFrame({ found: false, label: 'Face not in view' });
        }
      }
      frameId = requestAnimationFrame(loop);
      } catch (cause) {
        stopped = true;
        stream.getTracks().forEach(track => track.stop());
        video.pause(); video.srcObject = null; model?.close();
        onError(cause instanceof Error ? cause : new Error(String(cause)));
      }
    };
    frameId = requestAnimationFrame(loop);
    return { stop: () => {
      stopped = true; cancelAnimationFrame(frameId);
      stream.getTracks().forEach(track => track.stop());
      video.pause(); video.srcObject = null; model?.close();
    } };
  } catch (error) {
    stopped = true; cancelAnimationFrame(frameId);
    stream.getTracks().forEach(track => track.stop());
    video.srcObject = null; model?.close();
    throw error;
  }
}
