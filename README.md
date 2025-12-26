# Productivity Tracker Extension

This project consists of a Chrome Extension and a Python Backend.

## Prerequisites
1.  **Python** installed.
2.  **Google Gemini API Key**.

## Setup

### 1. Python Backend
1.  Navigate to `server/` directory.
2.  Install dependencies:
    ```bash
    pip install -r requirements.txt
    ```
3.  Edit `.env` file in the `server` directory and add your `GOOGLE_API_KEY`.
4.  Run the server:
    ```bash
    python app.py
    ```
    The server runs on `http://localhost:5000`.

### 2. Chrome Extension
1.  Open Chrome and go to `chrome://extensions`.
2.  Enable **Developer mode** (top right).
3.  Click **Load unpacked**.
4.  Select the `extension/` folder in this project (`d:\projects\tracking-extension\extension`).

## Usage
1.  Browse the web! The extension tracks time on active tabs.
2.  Click the extension icon and hit **"Generate Gemini Report"**.
3.  The extension sends your browsing history to the local Python server, which uses Gemini to classify sites and returns a report.
