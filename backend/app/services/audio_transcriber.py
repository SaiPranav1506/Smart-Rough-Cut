from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path
from typing import Optional
import speech_recognition as sr
from ..core.config import settings

class AudioTranscriber:
    """
    Smart Rough Cut Speech-to-Text Transcriber.
    Converts uploaded audio clips or recorded mic streams into text.
    """

    @classmethod
    def transcribe_audio(cls, input_audio_path: Path) -> str:
        if not input_audio_path.exists():
            return ""

        # Convert input audio (webm, mp3, mp4, ogg) to 16kHz mono WAV using FFmpeg
        temp_wav = Path(tempfile.gettempdir()) / f"stt_temp_{input_audio_path.stem}.wav"
        try:
            cmd = [
                settings.FFMPEG_PATH,
                "-y",
                "-i", str(input_audio_path),
                "-ar", "16000",
                "-ac", "1",
                "-c:a", "pcm_s16le",
                str(temp_wav)
            ]
            subprocess.run(cmd, capture_output=True, check=True)

            recognizer = sr.Recognizer()
            with sr.AudioFile(str(temp_wav)) as source:
                audio_data = recognizer.record(source)

            try:
                transcript = recognizer.recognize_google(audio_data)
                return transcript
            except sr.UnknownValueError:
                return ""
            except Exception as e:
                print(f"[AudioTranscriber] Recognition error: {e}")
                return ""
        finally:
            if temp_wav.exists():
                try:
                    temp_wav.unlink(missing_ok=True)
                except Exception:
                    pass

