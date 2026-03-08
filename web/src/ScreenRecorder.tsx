import { useEffect, useRef } from 'react';
import './ScreenRecorder.css';
import { mountScreenRecorder } from './screenRecorderBootstrap';

export function ScreenRecorder() {
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!rootRef.current) {
      return;
    }

    return mountScreenRecorder(rootRef.current);
  }, []);

  return (
    <>
      <section className="controls-wrapper">
        <div className="controls">
          <div className="controls-heading">
            <h1 className="controls-heading-title">Screen Recorder</h1>
            <p className="controls-subtitle">
              Capture a screen, window, or tab with audio, cursor, and an optional webcam
              overlay.
            </p>
          </div>
        </div>
      </section>

      <main className="grid single-grid screen-recorder-page">
        <section className="card screen-recorder-card">
          <div className="screen-recorder-tool" ref={rootRef}>
            <header className="card-header screen-recorder-header">
              <div className="card-header-top">
                <h2>Capture Setup</h2>
              </div>
            </header>

            <div className="screen-recorder-fields">
              <label className="number-field screen-recorder-field">
                <div className="screen-recorder-select-shell">
                  <select
                    id="resolution-select"
                    className="screen-recorder-native-select"
                    tabIndex={-1}
                    aria-hidden="true"
                  />
                </div>
              </label>

              <label className="number-field screen-recorder-field">
                <div className="screen-recorder-select-shell">
                  <select
                    id="fps-select"
                    className="screen-recorder-native-select"
                    tabIndex={-1}
                    aria-hidden="true"
                  />
                </div>
              </label>

              <label className="number-field screen-recorder-field">
                <div className="screen-recorder-select-shell">
                  <select
                    id="audio-select"
                    className="screen-recorder-native-select"
                    tabIndex={-1}
                    aria-hidden="true"
                  />
                </div>
              </label>

              <label className="number-field screen-recorder-field">
                <div className="screen-recorder-select-shell">
                  <select
                    id="format-select"
                    className="screen-recorder-native-select"
                    tabIndex={-1}
                    aria-hidden="true"
                  />
                </div>
              </label>
            </div>

            <div className="screen-recorder-actions">
              <label className="screen-recorder-toggle" htmlFor="cursor-toggle">
                <input id="cursor-toggle" type="checkbox" defaultChecked />
                <span>Show Cursor</span>
              </label>

              <div className="screen-recorder-webcam-group">
                <label className="screen-recorder-toggle screen-recorder-webcam-toggle" htmlFor="webcam-toggle">
                  <input id="webcam-toggle" type="checkbox" />
                  <span>Enable Webcam</span>
                </label>

                <div
                  className="screen-recorder-webcam-shape-slot"
                  id="webcam-shape-slot"
                  aria-hidden="true"
                >
                  <label
                    className="screen-recorder-toggle screen-recorder-webcam-shape-toggle"
                    id="webcam-shape-chip"
                    htmlFor="webcam-shape-toggle"
                  >
                    <input id="webcam-shape-toggle" type="checkbox" />
                    <span>Round Camera</span>
                  </label>
                </div>
              </div>

              <div className="screen-recorder-shortcuts" aria-label="Keyboard shortcuts">
                <span className="screen-recorder-shortcut">
                  <strong>Shift + F8</strong>
                </span>
                <span className="screen-recorder-shortcut">
                  <strong>Shift + F9</strong>
                </span>
                <span className="screen-recorder-shortcut">
                  <strong>Esc</strong>
                </span>
              </div>
            </div>

            <div className="screen-recorder-stage">
              <button className="screen-recorder-start" id="start-button" type="button">
                Start Recording
              </button>

              <div className="screen-recorder-readout">
                <div className="screen-recorder-pulse" id="pulse-indicator" aria-hidden="true"></div>
                <div className="screen-recorder-time" id="deck-timer">
                  00:00
                </div>
              </div>
            </div>

            <aside className="screen-recorder-webcam-overlay" id="webcam-overlay" hidden aria-hidden="true">
              <div className="screen-recorder-webcam-handle" id="webcam-overlay-handle">
                Webcam
              </div>
              <video id="webcam-preview" autoPlay muted playsInline></video>
            </aside>

            <div className="screen-recorder-toast-stack" id="toast-stack" aria-live="polite" aria-atomic="true"></div>

            <section className="screen-recorder-modal" id="save-modal" hidden aria-hidden="true">
              <div className="screen-recorder-modal-scrim" id="modal-scrim"></div>
              <div
                className="screen-recorder-modal-card"
                role="dialog"
                aria-modal="true"
                aria-labelledby="save-modal-title"
              >
                <div className="screen-recorder-modal-header">
                  <div>
                    <h2 id="save-modal-title">Recording Complete</h2>
                  </div>
                  <button
                    className="screen-recorder-icon-button"
                    id="close-modal-button"
                    type="button"
                    aria-label="Close save dialog"
                  >
                    ×
                  </button>
                </div>

                <div className="screen-recorder-modal-body">
                  <video id="recording-preview" controls playsInline></video>
                  <div className="screen-recorder-summary-panel" id="recording-summary"></div>
                </div>

                <div className="screen-recorder-modal-actions">
                  <button className="screen-recorder-primary-button" id="save-file-button" type="button">
                    Save Recording
                  </button>
                  <a className="screen-recorder-ghost-button" id="download-link" href="#" download>
                    Download in Browser
                  </a>
                  <button className="screen-recorder-ghost-button" id="dismiss-modal-button" type="button">
                    Close
                  </button>
                </div>
              </div>
            </section>
          </div>
        </section>
      </main>
    </>
  );
}
