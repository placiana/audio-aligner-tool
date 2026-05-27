# Audio Aligner

A semi-automated tool for aligning audio recordings with their corresponding text transcriptions. This project facilitates the creation of time-aligned text for applications like synchronized highlighting during audio playback.

## Preview

![Audio Aligner Interface](screenshot.png)

---

## Project Overview

The Audio Aligner is a Flask-based web application that streamlines the audio-text alignment process through a two-stage workflow:

1. **Segmentation (Stage 1):** The application uses silence detection to automatically suggest potential split points in long audio files (e.g., full Bible chapters). Users can visually adjust these segments using a waveform interface.
2. **Alignment (Stage 2):** Each segment is presented individually. The user plays the segment and highlights the corresponding text from the full transcription. The application then saves the start/end timestamps and the assigned text.
3. **Multi-language Support:** The application fully supports dynamic language switching between **English (default)** and **Spanish** via an interactive toggle button in the header. The chosen language is stored persistently in browser storage (`localStorage`).

### Key Technologies

*   **Backend:** Python 3, Flask
*   **Audio Processing:** `pydub` (slicing, silence detection), `librosa`
*   **Frontend:** Vanilla JavaScript, Wavesurfer.js (waveform visualization & regions)
*   **Data Storage:** Local JSON files (`config.json`, `state.json`)

---

## Directory Structure

*   `app.py`: Main Flask application handling API endpoints and server logic.
*   `process_bible.py`: Utility script to extract chapter-wise text files from a bulk JSON source.
*   `config.json`: Defines the available audio-text pairs (projects).
*   `state.json`: Persists the alignment progress, segment timestamps, and assigned text for each project.
*   `uploads/`:
    *   `audio/`: Source MP3 files.
    *   `texts/`: Chapter-wise text files.
*   `static/`:
    *   `js/main.js`: Core frontend logic, Wavesurfer integration, and API communication.
*   `templates/index.html`: The single-page application template.

---

## Building and Running

### Prerequisites

*   Python 3.x
*   FFmpeg (required by `pydub` for audio manipulation)

### Setup

1.  Create and activate a virtual environment:
    ```bash
    python -m venv venv
    source venv/bin/activate  # On Windows: venv\Scripts\activate
    ```
2.  Install dependencies:
    ```bash
    pip install -r requirements.txt
    ```

### Data Preparation

If you have a new `processed_data.json` file, run the processing script to generate individual text files:
```bash
python process_bible.py
```

### Running the Application

Start the Flask server:
```bash
python app.py
```
By default, the application will be available at `http://localhost:5000`.

---

## Development Conventions

*   **State Management:** The application is "stateless" on the server-side beyond writing to `state.json`. All alignment logic is handled in the frontend and synced via `/api/save_state`.
*   **Hotkeys:**
    *   `Space`: Play/Pause the current segment.
    *   `Ctrl + Enter`: Assign the currently selected text to the active segment and advance to the next.
*   **Adding New Audio:** 
    1.  Place the MP3 in `uploads/audio/`.
    2.  Ensure the corresponding text file exists in `uploads/texts/`.
    3.  Add an entry to `config.json`.
