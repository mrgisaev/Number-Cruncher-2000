type Tone = 'info' | 'success' | 'warn' | 'error';
type RecorderStatus = 'idle' | 'starting' | 'recording' | 'stopping';
type OutputFormat = 'webm' | 'mp4';

interface ResolutionPreset {
  id: string;
  label: string;
  width?: number;
  height?: number;
}

interface AudioOption {
  id: string;
  label: string;
  needsSystem: boolean;
  needsMic: boolean;
}

interface Size {
  width: number;
  height: number;
}

interface CaptureInfo {
  sourceSize: Size;
  outputSize: Size;
  surface: string;
  surfaceKind: string;
  audioLabel: string;
  hasSystemAudio: boolean;
  hasMicAudio: boolean;
  fps: number;
  cursorLabel: string;
  formatLabel: string;
  presetLabel: string;
  renderMode: string;
  webcamLabel: string;
}

interface SummaryItem {
  label: string;
  value: string;
}

interface WebcamRenderMetrics {
  margin: number;
  usableWidth: number;
  usableHeight: number;
  width: number;
  height: number;
}

interface Elements {
  audioSelect: HTMLSelectElement;
  closeModalButton: HTMLButtonElement;
  cursorToggle: HTMLInputElement;
  deckTimer: HTMLDivElement;
  dismissModalButton: HTMLButtonElement;
  downloadLink: HTMLAnchorElement;
  fpsSelect: HTMLSelectElement;
  formatSelect: HTMLSelectElement;
  modal: HTMLElement;
  modalScrim: HTMLElement;
  preview: HTMLVideoElement;
  pulseIndicator: HTMLDivElement;
  recordingSummary: HTMLDivElement;
  resolutionSelect: HTMLSelectElement;
  saveFileButton: HTMLButtonElement;
  saveModalTitle: HTMLElement;
  startButton: HTMLButtonElement;
  toastStack: HTMLDivElement;
  webcamOverlay: HTMLElement;
  webcamOverlayHandle: HTMLElement;
  webcamPreview: HTMLVideoElement;
  webcamShapeChip: HTMLElement;
  webcamShapeSlot: HTMLElement;
  webcamShapeToggle: HTMLInputElement;
  webcamToggle: HTMLInputElement;
}

interface SelectOptionDefinition {
  value: string;
  label: string;
}

interface CustomSelectControl {
  shell: HTMLElement;
  trigger: HTMLButtonElement;
  value: HTMLSpanElement;
  popover: HTMLDivElement;
  optionButtons: HTMLButtonElement[];
}

const RESOLUTION_PRESETS: ResolutionPreset[] = [
  { id: 'source', label: 'Source Resolution' },
  { id: '1080p', label: '1920 x 1080', width: 1920, height: 1080 },
  { id: '900p', label: '1600 x 900', width: 1600, height: 900 },
  { id: '720p', label: '1280 x 720', width: 1280, height: 720 },
  { id: '480p', label: '854 x 480', width: 854, height: 480 },
];

const FPS_PRESETS = [60, 30, 24];

const AUDIO_OPTIONS: AudioOption[] = [
  { id: 'system-mic', label: 'System + Mic', needsSystem: true, needsMic: true },
  { id: 'system', label: 'System Only', needsSystem: true, needsMic: false },
  { id: 'mic', label: 'Mic Only', needsSystem: false, needsMic: true },
  { id: 'silent', label: 'No Audio', needsSystem: false, needsMic: false },
];

const OUTPUT_FORMATS = [
  { id: 'webm', label: 'WebM' },
  { id: 'mp4', label: 'MP4' },
] as const;

const MIME_TYPES = [
  'video/webm;codecs=h264,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/webm;codecs=vp9,opus',
];

const MP4_CONVERSION_TIMEOUT_MS = 20 * 60 * 1000;

const mp4Converter: {
  instance: any;
  loadPromise: Promise<any> | null;
} = {
  instance: null,
  loadPromise: null,
};

export function mountScreenRecorder(root: HTMLElement) {
  const controller = new AbortController();
  const { signal } = controller;
  const elements = getElements(root);
  const customSelects = new Map<HTMLSelectElement, CustomSelectControl>();
  let openCustomSelect: HTMLSelectElement | null = null;

  const state: {
    destroyed: boolean;
    status: RecorderStatus;
    currentPresetId: string;
    currentFps: number;
    currentAudioId: string;
    currentOutputFormat: OutputFormat;
    currentCursorEnabled: boolean;
    currentWebcamEnabled: boolean;
    currentWebcamRound: boolean;
    sessionCompositeWebcam: boolean;
    sessionOutputFormat: OutputFormat;
    startedAt: number;
    timerIntervalId: number;
    displayStream: MediaStream | null;
    micStream: MediaStream | null;
    webcamStream: MediaStream | null;
    canvasStream: MediaStream | null;
    outputStream: MediaStream | null;
    sourceVideo: HTMLVideoElement | null;
    captureCanvas: HTMLCanvasElement | null;
    captureContext: CanvasRenderingContext2D | null;
    audioContext: AudioContext | null;
    mediaRecorder: MediaRecorder | null;
    chunks: BlobPart[];
    recorderMimeType: string;
    renderToken: number;
    renderCancel: (() => void) | null;
    webcamDragPointerId: number | null;
    webcamDragOffsetX: number;
    webcamDragOffsetY: number;
    webcamOverlay: { x: number; y: number };
    recordingBlob: Blob | null;
    recordingUrl: string;
    recordingName: string;
    recordingOutputFormat: OutputFormat;
    sourceRecordingName: string;
    convertedRecordingBlob: Blob | null;
    convertedRecordingUrl: string;
    recordingCaptureInfo: CaptureInfo | null;
    captureInfo: CaptureInfo | null;
  } = {
    destroyed: false,
    status: 'idle',
    currentPresetId: 'source',
    currentFps: 30,
    currentAudioId: 'system-mic',
    currentOutputFormat: 'webm',
    currentCursorEnabled: true,
    currentWebcamEnabled: false,
    currentWebcamRound: false,
    sessionCompositeWebcam: false,
    sessionOutputFormat: 'webm',
    startedAt: 0,
    timerIntervalId: 0,
    displayStream: null,
    micStream: null,
    webcamStream: null,
    canvasStream: null,
    outputStream: null,
    sourceVideo: null,
    captureCanvas: null,
    captureContext: null,
    audioContext: null,
    mediaRecorder: null,
    chunks: [],
    recorderMimeType: 'video/webm',
    renderToken: 0,
    renderCancel: null,
    webcamDragPointerId: null,
    webcamDragOffsetX: 0,
    webcamDragOffsetY: 0,
    webcamOverlay: { x: 1, y: 1 },
    recordingBlob: null,
    recordingUrl: '',
    recordingName: '',
    recordingOutputFormat: 'webm',
    sourceRecordingName: '',
    convertedRecordingBlob: null,
    convertedRecordingUrl: '',
    recordingCaptureInfo: null,
    captureInfo: null,
  };

  init();

  return () => {
    state.destroyed = true;
    controller.abort();
    cleanupCustomSelects();
    closeSaveModal();
    resetCompletedRecording();
    cleanupSession();
    stopWebcamPreview();
  };

  function init() {
    populateSelects();
    attachListeners();
    syncControls();
    syncDashboard();

    if (!supportsRecording()) {
      showToast('This browser does not support the APIs required for screen recording.', 'error', 7000);
      elements.startButton.disabled = true;
    }
  }

  function attachListeners() {
    document.addEventListener(
      'pointerdown',
      (event) => {
        if (!openCustomSelect) {
          return;
        }

        const control = customSelects.get(openCustomSelect);
        if (!control) {
          openCustomSelect = null;
          return;
        }

        if (event.target instanceof Node && control.shell.contains(event.target)) {
          return;
        }

        closeCustomSelect();
      },
      { signal },
    );

    elements.resolutionSelect.addEventListener(
      'change',
      () => {
        state.currentPresetId = elements.resolutionSelect.value;
      },
      { signal },
    );

    elements.fpsSelect.addEventListener(
      'change',
      () => {
        state.currentFps = Number(elements.fpsSelect.value);
      },
      { signal },
    );

    elements.audioSelect.addEventListener(
      'change',
      () => {
        state.currentAudioId = elements.audioSelect.value;
      },
      { signal },
    );

    elements.formatSelect.addEventListener(
      'change',
      () => {
        state.currentOutputFormat = elements.formatSelect.value as OutputFormat;
      },
      { signal },
    );

    elements.cursorToggle.addEventListener(
      'change',
      () => {
        state.currentCursorEnabled = elements.cursorToggle.checked;
      },
      { signal },
    );

    elements.webcamToggle.addEventListener(
      'change',
      () => {
        void handleWebcamToggleChange();
      },
      { signal },
    );

    elements.webcamShapeToggle.addEventListener(
      'change',
      () => {
        state.currentWebcamRound = elements.webcamShapeToggle.checked;
        syncWebcamOverlayAppearance();
      },
      { signal },
    );

    elements.startButton.addEventListener(
      'click',
      () => {
        if (state.status === 'recording') {
          stopRecording('manual-stop');
          return;
        }

        if (state.status === 'idle') {
          void startRecording();
        }
      },
      { signal },
    );

    elements.saveFileButton.addEventListener(
      'click',
      () => {
        void saveCurrentRecording();
      },
      { signal },
    );

    elements.dismissModalButton.addEventListener('click', closeSaveModal, { signal });
    elements.closeModalButton.addEventListener('click', closeSaveModal, { signal });
    elements.modalScrim.addEventListener('click', closeSaveModal, { signal });
    elements.webcamOverlayHandle.addEventListener('pointerdown', beginWebcamDrag, { signal });

    document.addEventListener(
      'keydown',
      (event) => {
        if (event.key === 'Escape' && !elements.modal.hidden) {
          closeSaveModal();
          return;
        }

        if (event.key === 'Escape' && openCustomSelect) {
          closeCustomSelect();
          return;
        }

        if (isTypingTarget(event.target)) {
          return;
        }

        if (
          event.shiftKey &&
          !event.altKey &&
          !event.ctrlKey &&
          !event.metaKey &&
          event.code === 'F8'
        ) {
          event.preventDefault();
          void startRecording();
        }

        if (
          event.shiftKey &&
          !event.altKey &&
          !event.ctrlKey &&
          !event.metaKey &&
          event.code === 'F9'
        ) {
          event.preventDefault();
          stopRecording('shortcut-stop');
        }
      },
      { signal },
    );

    window.addEventListener(
      'beforeunload',
      (event) => {
        if (state.status === 'recording' || state.status === 'starting' || state.status === 'stopping') {
          event.preventDefault();
          event.returnValue = '';
        }
      },
      { signal },
    );

    window.addEventListener('pointermove', handleWebcamDrag, { signal });
    window.addEventListener('pointerup', endWebcamDrag, { signal });
    window.addEventListener('pointercancel', endWebcamDrag, { signal });
    window.addEventListener('resize', syncWebcamOverlayPosition, { signal });
    document.addEventListener('visibilitychange', syncWebcamOverlayVisibility, { signal });
    window.addEventListener(
      'pagehide',
      () => {
        if (state.status === 'idle') {
          stopWebcamPreview();
        }
      },
      { signal },
    );
  }

  function populateSelects() {
    populateNativeSelect(
      elements.resolutionSelect,
      RESOLUTION_PRESETS.map((preset) => ({ value: preset.id, label: preset.label })),
    );
    populateNativeSelect(
      elements.fpsSelect,
      FPS_PRESETS.map((fps) => ({ value: String(fps), label: `${fps} fps` })),
    );
    populateNativeSelect(
      elements.audioSelect,
      AUDIO_OPTIONS.map((option) => ({ value: option.id, label: option.label })),
    );
    populateNativeSelect(
      elements.formatSelect,
      OUTPUT_FORMATS.map((option) => ({ value: option.id, label: option.label })),
    );

    mountCustomSelect(elements.resolutionSelect, 'Output Resolution');
    mountCustomSelect(elements.fpsSelect, 'Frames Per Second');
    mountCustomSelect(elements.audioSelect, 'Audio Source');
    mountCustomSelect(elements.formatSelect, 'File Format');
  }

  function populateNativeSelect(select: HTMLSelectElement, options: SelectOptionDefinition[]) {
    select.innerHTML = options
      .map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`)
      .join('');
  }

  function mountCustomSelect(select: HTMLSelectElement, ariaLabel: string) {
    const shell = select.closest('.screen-recorder-select-shell');
    if (!(shell instanceof HTMLElement)) {
      throw new Error(`Missing custom select shell for ${select.id}`);
    }

    let control = customSelects.get(select);
    if (!control) {
      shell.querySelectorAll('.screen-recorder-select-trigger, .screen-recorder-select-popover').forEach((node) => {
        node.remove();
      });

      const trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.className = 'editor-select-trigger screen-recorder-select-trigger';
      trigger.setAttribute('aria-haspopup', 'listbox');
      trigger.setAttribute('aria-label', ariaLabel);
      trigger.innerHTML = `
        <span class="editor-select-value screen-recorder-select-value"></span>
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4 6l4 4 4-4" />
        </svg>
      `;

      const value = trigger.querySelector('.screen-recorder-select-value');
      if (!(value instanceof HTMLSpanElement)) {
        throw new Error(`Missing custom select value node for ${select.id}`);
      }

      const popover = document.createElement('div');
      popover.className = 'editor-select-popover screen-recorder-select-popover';
      popover.setAttribute('role', 'listbox');
      popover.setAttribute('aria-label', `${ariaLabel} options`);
      popover.hidden = true;

      shell.append(trigger, popover);

      control = {
        shell,
        trigger,
        value,
        popover,
        optionButtons: [],
      };

      trigger.addEventListener(
        'click',
        () => {
          if (select.disabled) {
            return;
          }

          if (openCustomSelect === select) {
            closeCustomSelect();
            return;
          }

          openCustomSelect = select;
          syncCustomSelects();
        },
        { signal },
      );

      trigger.addEventListener(
        'keydown',
        (event) => {
          if (select.disabled) {
            return;
          }

          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            openCustomSelect = select;
            syncCustomSelects();
          }
        },
        { signal },
      );

      select.addEventListener(
        'change',
        () => {
          syncCustomSelect(select);
        },
        { signal },
      );

      customSelects.set(select, control);
    }

    control.popover.innerHTML = '';
    control.optionButtons = Array.from(select.options).map((option) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'editor-select-option screen-recorder-select-option';
      button.setAttribute('role', 'option');
      button.dataset.value = option.value;

      const label = document.createElement('span');
      label.textContent = option.textContent ?? '';
      button.append(label);

      button.addEventListener(
        'click',
        () => {
          if (select.disabled) {
            return;
          }

          if (select.value !== option.value) {
            select.value = option.value;
            select.dispatchEvent(new Event('change', { bubbles: true }));
          }

          closeCustomSelect();
        },
        { signal },
      );

      control?.popover.append(button);
      return button;
    });

    syncCustomSelect(select);
  }

  function cleanupCustomSelects() {
    openCustomSelect = null;

    for (const control of customSelects.values()) {
      control.trigger.remove();
      control.popover.remove();
    }

    customSelects.clear();
  }

  function closeCustomSelect() {
    if (!openCustomSelect) {
      return;
    }

    openCustomSelect = null;
    syncCustomSelects();
  }

  function syncCustomSelects() {
    for (const select of customSelects.keys()) {
      syncCustomSelect(select);
    }
  }

  function syncCustomSelect(select: HTMLSelectElement) {
    const control = customSelects.get(select);
    if (!control) {
      return;
    }

    const selectedOption = select.selectedOptions[0] ?? select.options[0] ?? null;
    const isOpen = openCustomSelect === select && !select.disabled;

    control.value.textContent = selectedOption?.textContent ?? '';
    control.trigger.disabled = select.disabled;
    control.trigger.classList.toggle('is-active', isOpen);
    control.trigger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    control.popover.hidden = !isOpen;

    for (const button of control.optionButtons) {
      const isActive = button.dataset.value === select.value;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-selected', isActive ? 'true' : 'false');
      button.disabled = select.disabled;
    }
  }

  async function startRecording() {
    if (!supportsRecording()) {
      showToast('MediaRecorder or getDisplayMedia is not available in this browser.', 'error', 7000);
      return;
    }

    if (state.status !== 'idle') {
      return;
    }

    resetCompletedRecording();
    state.status = 'starting';
    syncControls();
    syncDashboard();

    const preset = getSelectedPreset();
    const audioOption = getSelectedAudioOption();
    const outputFormat = state.currentOutputFormat;
    const fps = state.currentFps;
    const needsWebcam = state.currentWebcamEnabled;
    const compositeWebcam = needsWebcam;
    const requestedCaptureFps = getRequestedCaptureFps(fps, needsWebcam);
    let displayStream: MediaStream | null = null;
    let micStream: MediaStream | null = null;
    let webcamStream: MediaStream | null = null;
    let pipeline: Awaited<ReturnType<typeof buildPipeline>> | null = null;

    try {
      if (needsWebcam) {
        webcamStream = await ensureWebcamPreview();
      }

      displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: buildDisplayVideoConstraints(preset, requestedCaptureFps, state.currentCursorEnabled),
        audio: audioOption.needsSystem,
        systemAudio: audioOption.needsSystem ? 'include' : 'exclude',
        selfBrowserSurface: 'exclude',
        surfaceSwitching: 'include',
        monitorTypeSurfaces: 'include',
        preferCurrentTab: false,
      } as any);

      if (audioOption.needsMic) {
        try {
          micStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
          });
        } catch (error) {
          if (!audioOption.needsSystem) {
            throw new Error('Could not access the microphone.');
          }

          showToast('Microphone unavailable. Continuing without it.', 'warn', 5000);
        }
      }

      pipeline = await buildPipeline({
        displayStream,
        micStream,
        webcamStream,
        compositeWebcam,
        fps,
      });

      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(pipeline.outputStream, {
        mimeType,
        videoBitsPerSecond: estimateVideoBitrate(pipeline.outputSize, pipeline.fps),
      });

      recorder.addEventListener('dataavailable', (event) => {
        if (event.data.size > 0) {
          state.chunks.push(event.data);
        }
      });

      recorder.addEventListener('stop', () => {
        if (state.destroyed) {
          cleanupSession();
          return;
        }

        void finalizeRecording();
      });

      recorder.addEventListener('error', (event: Event) => {
        const recorderEvent = event as Event & { error?: { message?: string } };
        const message = recorderEvent.error?.message ?? 'Unknown MediaRecorder error.';
        showToast(message, 'error', 7000);

        if (state.status === 'recording' || state.status === 'starting') {
          stopRecording('recorder-error');
        }
      });

      const displayVideoTrack = displayStream.getVideoTracks()[0];
      displayVideoTrack.addEventListener(
        'ended',
        () => {
          if (state.status === 'recording' || state.status === 'starting') {
            stopRecording('capture-ended');
          }
        },
        { signal },
      );

      state.displayStream = displayStream;
      state.micStream = micStream;
      state.webcamStream = webcamStream ?? state.webcamStream;
      state.sessionCompositeWebcam = compositeWebcam;
      state.sessionOutputFormat = outputFormat;
      state.canvasStream = pipeline.canvasStream;
      state.outputStream = pipeline.outputStream;
      state.sourceVideo = pipeline.sourceVideo;
      state.captureCanvas = pipeline.captureCanvas;
      state.captureContext = pipeline.captureContext;
      state.audioContext = pipeline.audioContext;
      state.mediaRecorder = recorder;
      state.chunks = [];
      state.recorderMimeType = mimeType;
      state.captureInfo = {
        sourceSize: pipeline.sourceSize,
        outputSize: pipeline.outputSize,
        surface: mapSurfaceLabel(displayVideoTrack.getSettings().displaySurface),
        surfaceKind: displayVideoTrack.getSettings().displaySurface ?? 'unknown',
        audioLabel: buildActualAudioLabel({
          hasSystemAudio: displayStream.getAudioTracks().length > 0,
          hasMicAudio: Boolean(micStream?.getAudioTracks().length),
        }),
        hasSystemAudio: displayStream.getAudioTracks().length > 0,
        hasMicAudio: Boolean(micStream?.getAudioTracks().length),
        fps: pipeline.fps,
        cursorLabel: state.currentCursorEnabled ? 'Visible' : 'Hidden',
        formatLabel: outputFormat === 'mp4' ? 'MP4 (converted on save)' : 'WebM',
        presetLabel: preset.label,
        renderMode: pipeline.renderMode,
        webcamLabel: needsWebcam
          ? state.currentWebcamRound
            ? 'Enabled · round'
            : 'Enabled · rectangle'
          : 'Disabled',
      };

      recorder.start(1000);
      state.startedAt = Date.now();
      startTimer();
      state.status = 'recording';
      syncControls();
      syncDashboard();
    } catch (error) {
      cleanupSession();
      stopLooseTracks(displayStream);
      stopLooseTracks(micStream);
      stopLooseTracks(pipeline?.canvasStream);
      stopLooseTracks(pipeline?.outputStream);

      if (pipeline?.sourceVideo) {
        pipeline.sourceVideo.pause();
        pipeline.sourceVideo.srcObject = null;
      }

      if (pipeline?.audioContext) {
        void pipeline.audioContext.close().catch(() => {});
      }

      state.status = 'idle';
      syncControls();
      syncDashboard();

      const namedError = error as { name?: string };
      if (namedError?.name === 'AbortError' || namedError?.name === 'NotAllowedError') {
        showToast('Recording start was cancelled.', 'info', 4000);
        return;
      }

      showToast(formatErrorMessage(error), 'error', 7000);
    }
  }

  function stopRecording(reason: string) {
    if (state.status !== 'recording' && state.status !== 'starting') {
      return;
    }

    state.status = 'stopping';
    syncControls();
    syncDashboard();

    if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') {
      state.mediaRecorder.stop();
    } else {
      cleanupSession();
      state.status = 'idle';
      syncControls();
      syncDashboard();
    }

    if (reason === 'capture-ended') {
      showToast('Recording was stopped from the system sharing dialog.', 'info', 4500);
    }
  }

  async function finalizeRecording() {
    const blob = new Blob(state.chunks, {
      type: state.recorderMimeType || 'video/webm',
    });

    const captureInfo = state.captureInfo;
    const durationMs = state.startedAt ? Date.now() - state.startedAt : 0;
    const recordingBaseName = buildRecordingBaseName();
    const recordingOutputFormat = state.sessionOutputFormat || 'webm';
    const sourceRecordingName = `${recordingBaseName}.webm`;
    const recordingName = `${recordingBaseName}.${recordingOutputFormat}`;

    cleanupSession();
    state.status = 'idle';
    state.recordingBlob = blob;
    state.recordingCaptureInfo = captureInfo;
    state.recordingOutputFormat = recordingOutputFormat;
    state.sourceRecordingName = sourceRecordingName;
    state.recordingName = recordingName;
    syncControls();
    syncDashboard();

    if (blob.size === 0) {
      showToast('The recording file is empty. Try starting the recording again.', 'error', 7000);
      return;
    }

    state.recordingUrl = URL.createObjectURL(blob);
    showSaveModal({
      blob,
      captureInfo,
      durationMs,
      recordingName,
    });
    showToast('Recording is ready. Choose where to save the file.', 'success', 5000);
  }

  async function buildPipeline({
    displayStream,
    micStream,
    webcamStream,
    compositeWebcam,
    fps,
  }: {
    displayStream: MediaStream;
    micStream: MediaStream | null;
    webcamStream: MediaStream | null;
    compositeWebcam: boolean;
    fps: number;
  }) {
    const displayVideoTrack = displayStream.getVideoTracks()[0];
    try {
      displayVideoTrack.contentHint = 'motion';
    } catch {
      // Ignore contentHint failures in browsers that reject or ignore this hint.
    }

    const sourceVideo = document.createElement('video');
    sourceVideo.autoplay = true;
    sourceVideo.muted = true;
    sourceVideo.playsInline = true;
    sourceVideo.srcObject = displayStream;

    await waitForVideo(sourceVideo);

    let webcamVideo: HTMLVideoElement | null = null;
    if (webcamStream) {
      webcamVideo = elements.webcamPreview;
      if (webcamVideo.srcObject !== webcamStream) {
        webcamVideo.srcObject = webcamStream;
      }
      await waitForVideo(webcamVideo);
    }

    const sourceSize = {
      width: sourceVideo.videoWidth || displayVideoTrack.getSettings().width || 1920,
      height: sourceVideo.videoHeight || displayVideoTrack.getSettings().height || 1080,
    };

    const outputSize = sourceSize;
    const effectiveFps = resolveEffectiveOutputFps({
      requestedFps: fps,
      displayTrack: displayVideoTrack,
      webcamStream: compositeWebcam ? webcamStream : null,
    });
    const mixedAudio = await createMixedAudioChain(displayStream, micStream);
    const requiresCanvasResize = false;
    const requiresCanvasOverlay = compositeWebcam && Boolean(webcamVideo);
    const requiresCanvas = requiresCanvasResize || requiresCanvasOverlay;
    let captureCanvas: HTMLCanvasElement | null = null;
    let captureContext: CanvasRenderingContext2D | null = null;
    let canvasStream: MediaStream | null = null;
    let videoTrack = displayVideoTrack;
    let requestCanvasFrame: (() => void) | null = null;
    let renderMode = 'direct';

    if (requiresCanvas) {
      captureCanvas = document.createElement('canvas');
      captureCanvas.width = outputSize.width;
      captureCanvas.height = outputSize.height;

      captureContext = captureCanvas.getContext('2d', {
        alpha: false,
        desynchronized: true,
      });

      if (!captureContext) {
        throw new Error('Could not initialize the recording canvas.');
      }

      captureContext.imageSmoothingEnabled = true;
      captureContext.imageSmoothingQuality = 'low';

      const webcamRenderMetrics = webcamVideo
        ? createWebcamRenderMetrics(outputSize, webcamVideo)
        : null;

      canvasStream = captureCanvas.captureStream(0);
      let canvasVideoTrack = canvasStream.getVideoTracks()[0] as MediaStreamTrack & {
        requestFrame?: () => void;
      };
      if (typeof canvasVideoTrack.requestFrame === 'function') {
        requestCanvasFrame = () => {
          canvasVideoTrack.requestFrame?.();
        };
      } else {
        stopLooseTracks(canvasStream);
        canvasStream = captureCanvas.captureStream(effectiveFps);
        canvasVideoTrack = canvasStream.getVideoTracks()[0] as MediaStreamTrack & {
          requestFrame?: () => void;
        };
      }

      startCanvasRenderLoop({
        sourceVideo,
        webcamVideo,
        captureContext,
        outputSize,
        fps: effectiveFps,
        webcamRenderMetrics,
        requestCanvasFrame,
      });

      videoTrack = canvasVideoTrack;
      try {
        videoTrack.contentHint = 'motion';
      } catch {
        // Ignore contentHint failures in browsers that reject or ignore this hint.
      }
      renderMode = requiresCanvasOverlay ? 'canvas-webcam' : 'canvas-resize';
    } else {
      sourceVideo.pause();
      sourceVideo.srcObject = null;
    }

    const outputTracks: MediaStreamTrack[] = [videoTrack];
    if (mixedAudio?.stream) {
      outputTracks.push(...mixedAudio.stream.getAudioTracks());
    }

    return {
      audioContext: mixedAudio?.context ?? null,
      canvasStream,
      captureCanvas,
      captureContext,
      outputStream: new MediaStream(outputTracks),
      fps: effectiveFps,
      outputSize,
      renderMode,
      sourceSize,
      sourceVideo,
      webcamVideo,
    };
  }

  function startCanvasRenderLoop({
    sourceVideo,
    webcamVideo,
    captureContext,
    outputSize,
    fps,
    webcamRenderMetrics,
    requestCanvasFrame,
  }: {
    sourceVideo: HTMLVideoElement;
    webcamVideo: HTMLVideoElement | null;
    captureContext: CanvasRenderingContext2D;
    outputSize: Size;
    fps: number;
    webcamRenderMetrics: WebcamRenderMetrics | null;
    requestCanvasFrame: (() => void) | null;
  }) {
    stopCanvasRenderLoop();
    const token = ++state.renderToken;
    const frameDelayMs = Math.max(16, Math.round(1000 / Math.max(1, fps)));
    let lastRenderAt = 0;

    const renderFrame = (now: number) => {
      lastRenderAt = now;
      drawFrame(sourceVideo, webcamVideo, captureContext, outputSize, webcamRenderMetrics);
      requestCanvasFrame?.();
    };

    const queueNextFrame = () => {
      if (token !== state.renderToken) {
        return;
      }

      let settled = false;
      let callbackId: number | null = null;
      let timeoutId = 0;

      const cancelScheduledFrame = () => {
        if (callbackId !== null) {
          sourceVideo.cancelVideoFrameCallback?.(callbackId);
          callbackId = null;
        }

        if (timeoutId) {
          window.clearTimeout(timeoutId);
          timeoutId = 0;
        }
      };

      const runFrame = (now: number) => {
        if (settled || token !== state.renderToken) {
          return;
        }

        settled = true;
        cancelScheduledFrame();
        renderFrame(now);
        queueNextFrame();
      };

      const scheduleVideoFrame = () => {
        if (typeof sourceVideo.requestVideoFrameCallback !== 'function') {
          return;
        }

        callbackId = sourceVideo.requestVideoFrameCallback((now) => {
          callbackId = null;

          if (settled || token !== state.renderToken) {
            return;
          }

          if (now - lastRenderAt >= frameDelayMs - 1) {
            runFrame(now);
            return;
          }

          scheduleVideoFrame();
        });
      };

      scheduleVideoFrame();

      const remainingDelay = Math.max(0, frameDelayMs - (performance.now() - lastRenderAt));
      timeoutId = window.setTimeout(() => {
        runFrame(performance.now());
      }, remainingDelay);

      state.renderCancel = () => {
        settled = true;
        cancelScheduledFrame();
      };
    };

    renderFrame(performance.now());
    queueNextFrame();
  }

  function stopCanvasRenderLoop() {
    state.renderToken += 1;
    if (typeof state.renderCancel === 'function') {
      state.renderCancel();
    }
    state.renderCancel = null;
  }

  function drawFrame(
    sourceVideo: HTMLVideoElement,
    webcamVideo: HTMLVideoElement | null,
    captureContext: CanvasRenderingContext2D,
    outputSize: Size,
    webcamRenderMetrics: WebcamRenderMetrics | null,
  ) {
    const sourceWidth = sourceVideo.videoWidth || outputSize.width;
    const sourceHeight = sourceVideo.videoHeight || outputSize.height;
    const sourceAspect = sourceWidth / sourceHeight;
    const outputAspect = outputSize.width / outputSize.height;

    let drawWidth = outputSize.width;
    let drawHeight = outputSize.height;
    let offsetX = 0;
    let offsetY = 0;

    if (sourceAspect > outputAspect) {
      drawHeight = Math.round(outputSize.width / sourceAspect);
      offsetY = Math.floor((outputSize.height - drawHeight) / 2);
    } else if (sourceAspect < outputAspect) {
      drawWidth = Math.round(outputSize.height * sourceAspect);
      offsetX = Math.floor((outputSize.width - drawWidth) / 2);
    }

    if (offsetX !== 0 || offsetY !== 0 || drawWidth !== outputSize.width || drawHeight !== outputSize.height) {
      captureContext.fillStyle = '#0f1930';
      captureContext.fillRect(0, 0, outputSize.width, outputSize.height);
    }
    captureContext.drawImage(sourceVideo, offsetX, offsetY, drawWidth, drawHeight);

    if (
      webcamVideo?.readyState &&
      webcamVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
      webcamRenderMetrics &&
      shouldCompositeWebcamIntoRecording()
    ) {
      const rect = getWebcamDrawRect(webcamRenderMetrics);
      drawWebcamOverlay(captureContext, webcamVideo, rect);
    }
  }

  function createWebcamRenderMetrics(outputSize: Size, webcamVideo: HTMLVideoElement): WebcamRenderMetrics {
    const margin = Math.max(18, Math.round(outputSize.width * 0.02));
    const isRound = state.currentWebcamRound;
    const aspectRatio = getVideoAspectRatio(webcamVideo);
    const previewWidthCss =
      elements.webcamPreview.clientWidth ||
      (isRound ? clamp(window.innerWidth * 0.16, 160, 240) : clamp(window.innerWidth * 0.18, 180, 280));
    const previewHeightCss =
      elements.webcamPreview.clientHeight || (isRound ? previewWidthCss : previewWidthCss / aspectRatio);
    const deviceScale = Math.max(1, window.devicePixelRatio || 1);
    const previewWidth = Math.max(1, Math.round(previewWidthCss * deviceScale));
    const previewHeight = Math.max(1, Math.round(previewHeightCss * deviceScale));
    const maxWidth = isRound
      ? clamp(Math.round(outputSize.width * 0.18), 150, Math.round(outputSize.width * 0.24))
      : clamp(Math.round(outputSize.width * 0.2), 180, Math.round(outputSize.width * 0.28));
    const maxHeight = isRound ? maxWidth : Math.round(maxWidth / aspectRatio);
    const scale = Math.min(maxWidth / previewWidth, maxHeight / previewHeight, 1);
    const width = Math.max(1, Math.round(previewWidth * scale));
    const height = isRound ? width : Math.max(1, Math.round(previewHeight * scale));

    return {
      margin,
      usableWidth: Math.max(0, outputSize.width - width - margin * 2),
      usableHeight: Math.max(0, outputSize.height - height - margin * 2),
      width,
      height,
    };
  }

  function getWebcamDrawRect(metrics: WebcamRenderMetrics) {
    return {
      x: Math.round(metrics.margin + metrics.usableWidth * state.webcamOverlay.x),
      y: Math.round(metrics.margin + metrics.usableHeight * state.webcamOverlay.y),
      width: metrics.width,
      height: metrics.height,
    };
  }

  function drawWebcamOverlay(
    captureContext: CanvasRenderingContext2D,
    webcamVideo: HTMLVideoElement,
    rect: { x: number; y: number; width: number; height: number },
  ) {
    if (state.currentWebcamRound) {
      drawCircularWebcamOverlay(captureContext, webcamVideo, rect);
      return;
    }

    const radius = Math.max(14, Math.round(rect.width * 0.08));

    captureContext.save();
    drawRoundedRectPath(captureContext, rect.x, rect.y, rect.width, rect.height, radius);
    captureContext.clip();
    drawMirroredVideoFrame(captureContext, webcamVideo, rect);
    captureContext.restore();

    captureContext.save();
    drawRoundedRectPath(captureContext, rect.x, rect.y, rect.width, rect.height, radius);
    captureContext.lineWidth = Math.max(1.5, Math.round(rect.width * 0.009));
    captureContext.strokeStyle = 'rgba(239, 250, 255, 0.9)';
    captureContext.stroke();
    captureContext.restore();
  }

  function drawCircularWebcamOverlay(
    captureContext: CanvasRenderingContext2D,
    webcamVideo: HTMLVideoElement,
    rect: { x: number; y: number; width: number; height: number },
  ) {
    const radius = rect.width / 2;
    const centerX = rect.x + radius;
    const centerY = rect.y + radius;

    captureContext.save();
    captureContext.beginPath();
    captureContext.arc(centerX, centerY, radius, 0, Math.PI * 2);
    captureContext.clip();
    drawMirroredVideoFrame(captureContext, webcamVideo, rect);
    captureContext.restore();

    captureContext.save();
    captureContext.beginPath();
    captureContext.arc(centerX, centerY, Math.max(0, radius - 0.5), 0, Math.PI * 2);
    captureContext.lineWidth = Math.max(1.5, Math.round(rect.width * 0.009));
    captureContext.strokeStyle = 'rgba(239, 250, 255, 0.9)';
    captureContext.stroke();
    captureContext.restore();
  }

  function drawMirroredVideoFrame(
    captureContext: CanvasRenderingContext2D,
    webcamVideo: HTMLVideoElement,
    rect: { x: number; y: number; width: number; height: number },
  ) {
    const sourceWidth = webcamVideo.videoWidth || rect.width;
    const sourceHeight = webcamVideo.videoHeight || rect.height;
    const sourceAspect = sourceWidth / Math.max(1, sourceHeight);
    const targetAspect = rect.width / Math.max(1, rect.height);
    let cropWidth = sourceWidth;
    let cropHeight = sourceHeight;
    let cropX = 0;
    let cropY = 0;

    if (sourceAspect > targetAspect) {
      cropWidth = Math.max(1, Math.round(sourceHeight * targetAspect));
      cropX = Math.max(0, Math.floor((sourceWidth - cropWidth) / 2));
    } else if (sourceAspect < targetAspect) {
      cropHeight = Math.max(1, Math.round(sourceWidth / targetAspect));
      cropY = Math.max(0, Math.floor((sourceHeight - cropHeight) / 2));
    }

    captureContext.save();
    captureContext.translate(rect.x + rect.width, rect.y);
    captureContext.scale(-1, 1);
    captureContext.drawImage(webcamVideo, cropX, cropY, cropWidth, cropHeight, 0, 0, rect.width, rect.height);
    captureContext.restore();
  }

  function drawRoundedRectPath(
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
  ) {
    const safeRadius = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.moveTo(x + safeRadius, y);
    context.lineTo(x + width - safeRadius, y);
    context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
    context.lineTo(x + width, y + height - safeRadius);
    context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
    context.lineTo(x + safeRadius, y + height);
    context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
    context.lineTo(x, y + safeRadius);
    context.quadraticCurveTo(x, y, x + safeRadius, y);
    context.closePath();
  }

  async function createMixedAudioChain(displayStream: MediaStream, micStream: MediaStream | null) {
    const audioInputs: MediaStream[] = [];

    if (displayStream.getAudioTracks().length > 0) {
      audioInputs.push(new MediaStream(displayStream.getAudioTracks()));
    }

    if (micStream?.getAudioTracks().length) {
      audioInputs.push(new MediaStream(micStream.getAudioTracks()));
    }

    if (!audioInputs.length) {
      return null;
    }

    const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextCtor) {
      return null;
    }

    const context = new AudioContextCtor();
    const destination = context.createMediaStreamDestination();

    for (const input of audioInputs) {
      const source = context.createMediaStreamSource(input);
      const gain = context.createGain();
      gain.gain.value = 1;
      source.connect(gain).connect(destination);
    }

    if (context.state === 'suspended') {
      await context.resume();
    }

    return {
      context,
      stream: destination.stream,
    };
  }

  async function handleWebcamToggleChange() {
    state.currentWebcamEnabled = elements.webcamToggle.checked;

    if (!state.currentWebcamEnabled) {
      hideWebcamOverlay();
      if (state.status === 'idle') {
        stopWebcamPreview();
      }
      syncControls();
      return;
    }

    syncControls();

    try {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });
      await ensureWebcamPreview();
      syncControls();
      showToast(
        'Webcam enabled. Drag the preview to the corner you want before starting the recording.',
        'info',
        4500,
      );
    } catch (error) {
      state.currentWebcamEnabled = false;
      syncControls();
      showToast(formatErrorMessage(error), 'error', 7000);
    }
  }

  async function ensureWebcamPreview() {
    if (state.webcamStream?.getVideoTracks().some((track) => track.readyState === 'live')) {
      showWebcamOverlay();
      return state.webcamStream;
    }

    const webcamStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'user',
        width: { ideal: 960, max: 1280 },
        height: { ideal: 540, max: 720 },
        frameRate: { ideal: 30, max: 30 },
      },
      audio: false,
    });

    state.webcamStream = webcamStream;
    elements.webcamPreview.srcObject = webcamStream;
    await waitForVideo(elements.webcamPreview);
    showWebcamOverlay();
    return webcamStream;
  }

  function stopWebcamPreview() {
    if (state.webcamStream) {
      stopLooseTracks(state.webcamStream);
    }

    state.webcamStream = null;
    elements.webcamPreview.pause();
    elements.webcamPreview.srcObject = null;
    hideWebcamOverlay();
  }

  function showWebcamOverlay() {
    syncWebcamOverlayVisibility();
  }

  function hideWebcamOverlay() {
    elements.webcamOverlay.hidden = true;
    elements.webcamOverlay.setAttribute('aria-hidden', 'true');
    elements.webcamOverlay.classList.remove('is-dragging');
  }

  function syncWebcamOverlayVisibility() {
    const hasLivePreview = Boolean(state.webcamStream?.getVideoTracks().some((track) => track.readyState === 'live'));
    const shouldShow = state.currentWebcamEnabled && hasLivePreview;

    if (!shouldShow) {
      hideWebcamOverlay();
      return;
    }

    elements.webcamOverlay.hidden = false;
    elements.webcamOverlay.setAttribute('aria-hidden', 'false');
    syncWebcamOverlayAppearance();
    syncWebcamOverlayPosition();
  }

  function shouldCompositeWebcamIntoRecording() {
    return state.sessionCompositeWebcam && state.status === 'recording';
  }

  function syncWebcamOverlayAppearance() {
    elements.webcamOverlay.classList.toggle('is-round', state.currentWebcamRound);
    elements.webcamShapeToggle.checked = state.currentWebcamRound;
    syncWebcamOverlayPosition();
  }

  function syncWebcamOverlayPosition() {
    if (elements.webcamOverlay.hidden) {
      return;
    }

    const rect = getWebcamOverlayViewportRect();
    elements.webcamOverlay.style.transform = `translate(${Math.round(rect.left)}px, ${Math.round(rect.top)}px)`;
  }

  function getWebcamOverlayViewportRect() {
    const fallbackWidth = state.currentWebcamRound
      ? clamp(window.innerWidth * 0.16, 160, 240)
      : clamp(window.innerWidth * 0.18, 180, 280);
    const fallbackHeight = state.currentWebcamRound
      ? fallbackWidth + 42
      : fallbackWidth / getVideoAspectRatio(elements.webcamPreview) + 34;
    const width = elements.webcamOverlay.offsetWidth || fallbackWidth;
    const height = elements.webcamOverlay.offsetHeight || fallbackHeight;
    const margin = 16;
    const usableWidth = Math.max(0, window.innerWidth - width - margin * 2);
    const usableHeight = Math.max(0, window.innerHeight - height - margin * 2);

    return {
      width,
      height,
      left: margin + usableWidth * state.webcamOverlay.x,
      top: margin + usableHeight * state.webcamOverlay.y,
    };
  }

  function beginWebcamDrag(event: PointerEvent) {
    if (elements.webcamOverlay.hidden || event.button !== 0) {
      return;
    }

    const rect = getWebcamOverlayViewportRect();
    state.webcamDragPointerId = event.pointerId;
    state.webcamDragOffsetX = event.clientX - rect.left;
    state.webcamDragOffsetY = event.clientY - rect.top;
    elements.webcamOverlay.classList.add('is-dragging');
    elements.webcamOverlayHandle.setPointerCapture(event.pointerId);
  }

  function handleWebcamDrag(event: PointerEvent) {
    if (state.webcamDragPointerId !== event.pointerId) {
      return;
    }

    const rect = getWebcamOverlayViewportRect();
    const margin = 16;
    const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin);
    const maxTop = Math.max(margin, window.innerHeight - rect.height - margin);
    const clampedLeft = clamp(event.clientX - state.webcamDragOffsetX, margin, maxLeft);
    const clampedTop = clamp(event.clientY - state.webcamDragOffsetY, margin, maxTop);
    const usableWidth = Math.max(1, maxLeft - margin);
    const usableHeight = Math.max(1, maxTop - margin);

    state.webcamOverlay.x = clamp((clampedLeft - margin) / usableWidth, 0, 1);
    state.webcamOverlay.y = clamp((clampedTop - margin) / usableHeight, 0, 1);
    syncWebcamOverlayPosition();
  }

  function endWebcamDrag(event: PointerEvent) {
    if (state.webcamDragPointerId !== event.pointerId) {
      return;
    }

    state.webcamDragPointerId = null;
    elements.webcamOverlay.classList.remove('is-dragging');
    if (elements.webcamOverlayHandle.hasPointerCapture(event.pointerId)) {
      elements.webcamOverlayHandle.releasePointerCapture(event.pointerId);
    }
  }

  async function saveCurrentRecording() {
    if (!state.recordingBlob) {
      return;
    }

    const originalLabel = elements.saveFileButton.textContent || 'Save Recording';
    elements.saveFileButton.disabled = true;

    try {
      const saveTarget = await resolveSaveTarget();
      triggerBrowserDownload(saveTarget.url, saveTarget.name);
      showToast(
        saveTarget.format === 'mp4' ? 'MP4 download started.' : 'Download started.',
        'success',
        4000,
      );
    } catch (error) {
      const namedError = error as { name?: string };
      if (namedError?.name === 'AbortError') {
        return;
      }

      showToast(formatErrorMessage(error), 'error', 7000);
    } finally {
      elements.saveFileButton.disabled = false;
      elements.saveFileButton.textContent = originalLabel;
      syncSaveActions();
    }
  }

  async function resolveSaveTarget() {
    if (state.recordingOutputFormat === 'mp4') {
      elements.saveFileButton.textContent = 'Converting to MP4...';
      showToast('Converting the recording to MP4. This may take a moment.', 'info', 5000);
      return convertRecordingToMp4();
    }

    return {
      blob: state.recordingBlob as Blob,
      format: 'webm' as OutputFormat,
      name: state.recordingName,
      url: state.recordingUrl,
    };
  }

  async function convertRecordingToMp4() {
    if (state.convertedRecordingBlob && state.convertedRecordingUrl) {
      return {
        blob: state.convertedRecordingBlob,
        format: 'mp4' as OutputFormat,
        name: state.recordingName,
        url: state.convertedRecordingUrl,
      };
    }

    if (!state.recordingBlob) {
      throw new Error('No recording available for conversion.');
    }

    const ffmpeg = await ensureMp4Converter();
    const hasAudio = Boolean(
      state.recordingCaptureInfo?.hasSystemAudio || state.recordingCaptureInfo?.hasMicAudio,
    );
    const inputName = 'capture-input.webm';
    const outputName = 'capture-output.mp4';
    const inputData = new Uint8Array(await state.recordingBlob.arrayBuffer());

    try {
      await ffmpeg.writeFile(inputName, inputData);

      const command = [
        '-i',
        inputName,
        '-vf',
        'scale=trunc(iw/2)*2:trunc(ih/2)*2',
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '23',
        '-pix_fmt',
        'yuv420p',
      ];

      if (hasAudio) {
        command.push('-c:a', 'aac', '-b:a', '192k');
      } else {
        command.push('-an');
      }

      command.push('-movflags', '+faststart', outputName);

      const exitCode = await ffmpeg.exec(command, MP4_CONVERSION_TIMEOUT_MS);
      if (exitCode !== 0) {
        throw new Error('Could not convert the recording to MP4.');
      }

      const outputData = await ffmpeg.readFile(outputName);
      const mp4Blob = new Blob([outputData], {
        type: 'video/mp4',
      });

      state.convertedRecordingBlob = mp4Blob;
      state.convertedRecordingUrl = URL.createObjectURL(mp4Blob);

      return {
        blob: state.convertedRecordingBlob,
        format: 'mp4' as OutputFormat,
        name: state.recordingName,
        url: state.convertedRecordingUrl,
      };
    } finally {
      await cleanupConverterFile(ffmpeg, inputName);
      await cleanupConverterFile(ffmpeg, outputName);
    }
  }

  async function ensureMp4Converter() {
    if (mp4Converter.instance?.loaded) {
      return mp4Converter.instance;
    }

    if (mp4Converter.loadPromise) {
      return mp4Converter.loadPromise;
    }

    mp4Converter.loadPromise = (async () => {
      const { FFmpeg } = await import('@ffmpeg/ffmpeg');
      const ffmpeg = mp4Converter.instance ?? new FFmpeg();

      if (!ffmpeg.loaded) {
        await ffmpeg.load({
          coreURL: new URL('./vendor/ffmpeg/ffmpeg-core.js', window.location.href).href,
          wasmURL: new URL('./vendor/ffmpeg/ffmpeg-core.wasm', window.location.href).href,
        });
      }

      mp4Converter.instance = ffmpeg;
      return ffmpeg;
    })();

    try {
      return await mp4Converter.loadPromise;
    } finally {
      mp4Converter.loadPromise = null;
    }
  }

  async function cleanupConverterFile(ffmpeg: any, fileName: string) {
    try {
      await ffmpeg.deleteFile(fileName);
    } catch {
      // Ignore missing temp files between repeated conversions.
    }
  }

  function triggerBrowserDownload(url: string, name: string) {
    if (!url) {
      return;
    }

    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
  }

  function showSaveModal({
    blob,
    captureInfo,
    durationMs,
    recordingName,
  }: {
    blob: Blob;
    captureInfo: CaptureInfo | null;
    durationMs: number;
    recordingName: string;
  }) {
    elements.preview.src = state.recordingUrl;
    elements.preview.load();
    elements.downloadLink.href = state.recordingUrl;
    elements.downloadLink.download = state.sourceRecordingName || recordingName;

    const items: SummaryItem[] = [
      { label: 'File', value: recordingName },
      { label: 'Format', value: captureInfo?.formatLabel ?? 'WebM' },
      { label: 'Duration', value: formatDuration(durationMs) },
      { label: 'Size', value: formatBytes(blob.size) },
      { label: 'Output', value: formatSizeLabel(captureInfo?.outputSize) },
      { label: 'Source', value: formatSizeLabel(captureInfo?.sourceSize) },
      { label: 'Audio', value: captureInfo?.audioLabel ?? 'No Audio' },
      { label: 'Cursor', value: captureInfo?.cursorLabel ?? 'Unknown' },
      { label: 'Webcam', value: captureInfo?.webcamLabel ?? 'Disabled' },
      { label: 'FPS', value: captureInfo?.fps ? `${captureInfo.fps} fps` : 'Unknown' },
    ];

    elements.recordingSummary.innerHTML = items.map(renderSummaryItem).join('');
    elements.modal.hidden = false;
    elements.modal.setAttribute('aria-hidden', 'false');
    syncSaveActions();
  }

  function closeSaveModal() {
    elements.modal.hidden = true;
    elements.modal.setAttribute('aria-hidden', 'true');
    elements.preview.pause();
  }

  function renderSummaryItem(item: SummaryItem) {
    return `
      <article class="screen-recorder-summary-row">
        <strong class="screen-recorder-summary-value">
          <span class="screen-recorder-summary-label">${escapeHtml(item.label)}:</span>
          ${escapeHtml(item.value)}
        </strong>
      </article>
    `;
  }

  function syncControls() {
    elements.resolutionSelect.value = state.currentPresetId;
    elements.fpsSelect.value = String(state.currentFps);
    elements.audioSelect.value = state.currentAudioId;
    elements.formatSelect.value = state.currentOutputFormat;
    elements.cursorToggle.checked = state.currentCursorEnabled;
    elements.webcamToggle.checked = state.currentWebcamEnabled;
    elements.webcamShapeToggle.checked = state.currentWebcamRound;
    elements.webcamShapeSlot.classList.toggle('is-visible', state.currentWebcamEnabled);
    elements.webcamShapeSlot.setAttribute('aria-hidden', state.currentWebcamEnabled ? 'false' : 'true');
    syncWebcamOverlayVisibility();

    const isLocked =
      state.status === 'starting' || state.status === 'recording' || state.status === 'stopping';
    elements.startButton.disabled =
      !supportsRecording() || state.status === 'starting' || state.status === 'stopping';
    elements.resolutionSelect.disabled = isLocked;
    elements.fpsSelect.disabled = isLocked;
    elements.audioSelect.disabled = isLocked;
    elements.formatSelect.disabled = isLocked;
    elements.cursorToggle.disabled = isLocked;
    elements.webcamToggle.disabled = isLocked;
    elements.webcamShapeToggle.disabled = isLocked || !state.currentWebcamEnabled;

    if (isLocked && openCustomSelect) {
      closeCustomSelect();
    }

    syncCustomSelects();

    if (state.status === 'recording') {
      elements.startButton.textContent = 'Stop Recording';
      elements.startButton.classList.add('is-danger');
    } else if (state.status === 'starting') {
      elements.startButton.textContent = 'Requesting Access...';
      elements.startButton.classList.remove('is-danger');
    } else if (state.status === 'stopping') {
      elements.startButton.textContent = 'Saving...';
      elements.startButton.classList.remove('is-danger');
    } else {
      elements.startButton.textContent = 'Start Recording';
      elements.startButton.classList.remove('is-danger');
    }
  }

  function syncDashboard() {
    elements.deckTimer.textContent = formatDuration(state.startedAt ? Date.now() - state.startedAt : 0);
    elements.pulseIndicator.classList.toggle('is-active', state.status === 'recording');
  }

  function startTimer() {
    stopTimer();
    state.timerIntervalId = window.setInterval(() => {
      syncDashboard();
    }, 250);
  }

  function stopTimer() {
    if (state.timerIntervalId) {
      window.clearInterval(state.timerIntervalId);
      state.timerIntervalId = 0;
    }
  }

  function cleanupSession() {
    stopTimer();
    stopCanvasRenderLoop();

    const streams = [state.displayStream, state.micStream, state.canvasStream, state.outputStream].filter(
      Boolean,
    ) as MediaStream[];
    const tracks = new Set(streams.flatMap((stream) => stream.getTracks()));

    for (const track of tracks) {
      track.stop();
    }

    if (state.sourceVideo) {
      state.sourceVideo.pause();
      state.sourceVideo.srcObject = null;
    }

    if (state.audioContext) {
      void state.audioContext.close().catch(() => {});
    }

    state.startedAt = 0;
    state.displayStream = null;
    state.micStream = null;
    state.canvasStream = null;
    state.outputStream = null;
    state.sessionCompositeWebcam = false;
    state.sourceVideo = null;
    state.captureCanvas = null;
    state.captureContext = null;
    state.audioContext = null;
    state.mediaRecorder = null;
    state.chunks = [];
    state.captureInfo = null;
  }

  function stopLooseTracks(stream: MediaStream | null | undefined) {
    if (!stream) {
      return;
    }

    for (const track of stream.getTracks()) {
      track.stop();
    }
  }

  function resetCompletedRecording() {
    closeSaveModal();

    if (state.recordingUrl) {
      URL.revokeObjectURL(state.recordingUrl);
    }

    if (state.convertedRecordingUrl) {
      URL.revokeObjectURL(state.convertedRecordingUrl);
    }

    state.recordingBlob = null;
    state.recordingUrl = '';
    state.recordingName = '';
    state.recordingOutputFormat = 'webm';
    state.sourceRecordingName = '';
    state.convertedRecordingBlob = null;
    state.convertedRecordingUrl = '';
    state.recordingCaptureInfo = null;
    elements.preview.removeAttribute('src');
    elements.preview.load();
    elements.recordingSummary.innerHTML = '';
    elements.downloadLink.removeAttribute('href');
  }

  function getSelectedPreset() {
    return RESOLUTION_PRESETS.find((preset) => preset.id === state.currentPresetId) ?? RESOLUTION_PRESETS[0];
  }

  function getSelectedAudioOption() {
    return AUDIO_OPTIONS.find((option) => option.id === state.currentAudioId) ?? AUDIO_OPTIONS[0];
  }

  function getRequestedCaptureFps(fps: number, webcamEnabled: boolean) {
    return webcamEnabled ? Math.min(fps, 30) : fps;
  }

  function buildDisplayVideoConstraints(preset: ResolutionPreset, fps: number, cursorEnabled: boolean) {
    const constraints: Record<string, unknown> = {
      frameRate: {
        ideal: fps,
        max: fps,
      },
      ...(cursorEnabled ? { cursor: 'always' } : { cursor: 'never' }),
    };

    if (preset.width && preset.height) {
      constraints.width = {
        ideal: preset.width,
        max: preset.width,
      };
      constraints.height = {
        ideal: preset.height,
        max: preset.height,
      };
      constraints.resizeMode = 'crop-and-scale';
    }

    return constraints;
  }

  function resolveEffectiveOutputFps({
    requestedFps,
    displayTrack,
    webcamStream,
  }: {
    requestedFps: number;
    displayTrack: MediaStreamTrack;
    webcamStream: MediaStream | null;
  }) {
    const candidates = [
      normalizeTrackFrameRate(displayTrack.getSettings().frameRate),
      normalizeTrackFrameRate(webcamStream?.getVideoTracks()[0]?.getSettings().frameRate),
    ].filter((value): value is number => value !== null);

    let resolvedFps = Math.max(1, Math.round(requestedFps));
    for (const candidate of candidates) {
      resolvedFps = Math.min(resolvedFps, candidate);
    }

    return Math.max(1, resolvedFps);
  }

  function normalizeTrackFrameRate(value: unknown) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      return null;
    }

    return Math.max(1, Math.round(value));
  }

  function buildActualAudioLabel({
    hasSystemAudio,
    hasMicAudio,
  }: {
    hasSystemAudio: boolean;
    hasMicAudio: boolean;
  }) {
    if (hasSystemAudio && hasMicAudio) {
      return 'System + Microphone';
    }

    if (hasSystemAudio) {
      return 'System Audio Only';
    }

    if (hasMicAudio) {
      return 'Microphone Only';
    }

    return 'No Audio';
  }

  function pickMimeType() {
    for (const mimeType of MIME_TYPES) {
      if (MediaRecorder.isTypeSupported(mimeType)) {
        return mimeType;
      }
    }

    return 'video/webm';
  }

  function estimateVideoBitrate(outputSize: Size, fps: number) {
    const pixels = outputSize.width * outputSize.height;

    if (pixels >= 2560 * 1440) {
      return fps >= 60 ? 14_000_000 : 10_000_000;
    }

    if (pixels >= 1920 * 1080) {
      return fps >= 60 ? 10_000_000 : 7_500_000;
    }

    if (pixels >= 1280 * 720) {
      return fps >= 60 ? 7_500_000 : 5_500_000;
    }

    return fps >= 60 ? 5_500_000 : 4_000_000;
  }

  function syncSaveActions() {
    if (state.recordingOutputFormat === 'mp4') {
      elements.downloadLink.textContent = 'Download Original WebM';
      elements.saveModalTitle.textContent = 'Recording Complete';
      elements.saveFileButton.textContent = 'Save MP4';

      return;
    }

    elements.downloadLink.textContent = 'Download in Browser';
    elements.saveFileButton.textContent = 'Save Recording';
  }

  function buildRecordingBaseName() {
    const stamp = new Date()
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\..+/, '')
      .replace('T', '-');

    return `capture-${stamp}`;
  }

  function mapSurfaceLabel(displaySurface: string | undefined) {
    if (displaySurface === 'monitor') {
      return 'Screen Capture';
    }

    if (displaySurface === 'window') {
      return 'Window Capture';
    }

    if (displaySurface === 'browser') {
      return 'Tab Capture';
    }

    return 'Active Source';
  }

  function supportsRecording() {
    return Boolean(
      typeof navigator.mediaDevices?.getDisplayMedia === 'function' &&
        'MediaRecorder' in window &&
        typeof HTMLCanvasElement.prototype.captureStream === 'function',
    );
  }

  function waitForVideo(video: HTMLVideoElement) {
    return new Promise<void>((resolve, reject) => {
      let settled = false;

      const cleanup = () => {
        video.removeEventListener('loadedmetadata', handleReady);
        video.removeEventListener('loadeddata', handleReady);
        video.removeEventListener('canplay', handleReady);
        video.removeEventListener('error', handleError);
      };

      const handleReady = async () => {
        if (
          settled ||
          video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
          !video.videoWidth ||
          !video.videoHeight
        ) {
          return;
        }

        settled = true;
        cleanup();

        try {
          await video.play();
        } catch {
          // User activation already happened on getDisplayMedia. Ignore autoplay failures.
        }

        resolve();
      };

      const handleError = () => {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();
        reject(new Error('Could not prepare the video stream.'));
      };

      if (
        video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
        video.videoWidth &&
        video.videoHeight
      ) {
        void handleReady();
        return;
      }

      video.addEventListener('loadedmetadata', handleReady);
      video.addEventListener('loadeddata', handleReady);
      video.addEventListener('canplay', handleReady);
      video.addEventListener('error', handleError);
    });
  }

  function getVideoAspectRatio(video: HTMLVideoElement) {
    if (video.videoWidth && video.videoHeight) {
      return video.videoWidth / video.videoHeight;
    }

    return 4 / 3;
  }

  function formatDuration(durationMs: number) {
    const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  function formatBytes(bytes: number) {
    if (bytes < 1024) {
      return `${bytes} B`;
    }

    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }

    if (bytes < 1024 * 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  function formatSizeLabel(size?: Size | null) {
    if (!size?.width || !size?.height) {
      return 'Unknown';
    }

    return `${size.width} x ${size.height}`;
  }

  function showToast(message: string, tone: Tone = 'info', duration = 4000) {
    if (state.destroyed) {
      return;
    }

    const toast = document.createElement('div');
    toast.className = `screen-recorder-toast is-${tone}`;
    toast.textContent = message;
    elements.toastStack.append(toast);

    requestAnimationFrame(() => {
      toast.classList.add('is-visible');
    });

    window.setTimeout(() => {
      toast.classList.remove('is-visible');
      window.setTimeout(() => {
        toast.remove();
      }, 180);
    }, duration);
  }

  function escapeHtml(value: string) {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function isTypingTarget(target: EventTarget | null) {
    if (!(target instanceof HTMLElement)) {
      return false;
    }

    const tagName = target.tagName;
    return (
      target.isContentEditable ||
      tagName === 'INPUT' ||
      tagName === 'TEXTAREA' ||
      tagName === 'SELECT'
    );
  }

  function clamp(value: number, min: number, max: number) {
    return Math.min(Math.max(value, min), max);
  }

  function formatErrorMessage(error: unknown) {
    if (error instanceof Error && error.message) {
      return error.message;
    }

    return 'An unexpected error occurred.';
  }
}

function getElements(root: HTMLElement): Elements {
  return {
    audioSelect: getRequiredElement<HTMLSelectElement>(root, '#audio-select'),
    closeModalButton: getRequiredElement<HTMLButtonElement>(root, '#close-modal-button'),
    cursorToggle: getRequiredElement<HTMLInputElement>(root, '#cursor-toggle'),
    deckTimer: getRequiredElement<HTMLDivElement>(root, '#deck-timer'),
    dismissModalButton: getRequiredElement<HTMLButtonElement>(root, '#dismiss-modal-button'),
    downloadLink: getRequiredElement<HTMLAnchorElement>(root, '#download-link'),
    fpsSelect: getRequiredElement<HTMLSelectElement>(root, '#fps-select'),
    formatSelect: getRequiredElement<HTMLSelectElement>(root, '#format-select'),
    modal: getRequiredElement<HTMLElement>(root, '#save-modal'),
    modalScrim: getRequiredElement<HTMLElement>(root, '#modal-scrim'),
    preview: getRequiredElement<HTMLVideoElement>(root, '#recording-preview'),
    pulseIndicator: getRequiredElement<HTMLDivElement>(root, '#pulse-indicator'),
    recordingSummary: getRequiredElement<HTMLDivElement>(root, '#recording-summary'),
    resolutionSelect: getRequiredElement<HTMLSelectElement>(root, '#resolution-select'),
    saveFileButton: getRequiredElement<HTMLButtonElement>(root, '#save-file-button'),
    saveModalTitle: getRequiredElement<HTMLElement>(root, '#save-modal-title'),
    startButton: getRequiredElement<HTMLButtonElement>(root, '#start-button'),
    toastStack: getRequiredElement<HTMLDivElement>(root, '#toast-stack'),
    webcamOverlay: getRequiredElement<HTMLElement>(root, '#webcam-overlay'),
    webcamOverlayHandle: getRequiredElement<HTMLElement>(root, '#webcam-overlay-handle'),
    webcamPreview: getRequiredElement<HTMLVideoElement>(root, '#webcam-preview'),
    webcamShapeChip: getRequiredElement<HTMLElement>(root, '#webcam-shape-chip'),
    webcamShapeSlot: getRequiredElement<HTMLElement>(root, '#webcam-shape-slot'),
    webcamShapeToggle: getRequiredElement<HTMLInputElement>(root, '#webcam-shape-toggle'),
    webcamToggle: getRequiredElement<HTMLInputElement>(root, '#webcam-toggle'),
  };
}

function getRequiredElement<T extends Element>(root: ParentNode, selector: string) {
  const element = root.querySelector(selector);
  if (!element) {
    throw new Error(`Missing required element: ${selector}`);
  }
  return element as T;
}
