document.getElementById('generateBtn').addEventListener('click', async () => {
    const statusDiv = document.getElementById('report');
    const loadingDiv = document.getElementById('loading');
    const btn = document.getElementById('generateBtn');

    statusDiv.innerHTML = '';
    loadingDiv.style.display = 'block';
    btn.disabled = true;

    try {
        const data = await chrome.storage.local.get(['history', 'currentEntry']);
        // Clone history
        let history = data.history ? JSON.parse(JSON.stringify(data.history)) : [];
        const currentEntry = data.currentEntry;

        // Add current session tentatively
        if (currentEntry) {
            const now = Date.now();
            const duration = (now - currentEntry.startTime) / 1000;
            if (duration > 1) {
                history.push({
                    title: currentEntry.title,
                    url: currentEntry.url,
                    duration: duration
                });
            }
        }

        if (history.length === 0) {
            loadingDiv.style.display = 'none';
            statusDiv.innerHTML = "<p style='text-align:center'>No browsing history recorded yet.</p>";
            btn.disabled = false;
            return;
        }

        // Send to Python
        const response = await fetch('http://localhost:5000/classify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ history: history })
        });

        if (!response.ok) {
            throw new Error('Failed to connect to backend server');
        }

        const report = await response.json();

        // Render
        let html = `
            <div style="display: flex; justify-content: center; margin-bottom: 20px;">
                <canvas id="chartCanvas" width="150" height="150"></canvas>
            </div>
            <div class="stat-box">
                <div>
                    <div style="font-size:11px; color:#888;">Productive</div>
                    <div class="prod">${formatTime(report.productive_time)}</div>
                </div>
                <div>
                    <div style="font-size:11px; color:#888;">Distracting</div>
                    <div class="dist">${formatTime(report.distracting_time)}</div>
                </div>
            </div>
            <div class="list-container">
        `;

        report.details.forEach(item => {
            const isProd = item.classification === 'Productive';
            const tagClass = isProd ? 'tag prod' : 'tag dist';
            const tagName = isProd ? 'P' : 'D';

            html += `
                <div class="site-item">
                    <div class="site-info">
                        <span class="site-title" title="${item.title}">${item.title}</span>
                        <span class="site-time">${formatTime(item.duration)}</span>
                    </div>
                    <span class="${tagClass}">${tagName}</span>
                </div>
            `;
        });

        html += '</div>';
        statusDiv.innerHTML = html;

        // Draw Chart
        drawChart(report.productive_time, report.distracting_time);

        // CLEAR HISTORY to prevent double counting
        // Also update currentEntry.startTime to now, so the next updateHistory ignores time already reported
        const newNow = Date.now();
        const updatedData = { history: [] };
        if (currentEntry) {
            updatedData.currentEntry = { ...currentEntry, startTime: newNow };
        }
        await chrome.storage.local.set(updatedData);

    } catch (err) {
        console.error(err);
        statusDiv.innerHTML = `<p style="color:red; text-align:center; font-size:12px">Error: ${err.message}.<br>Make sure the Python server and MongoDB are running!</p>`;
    } finally {
        loadingDiv.style.display = 'none';
        btn.disabled = false;
    }
});

document.getElementById('clearBtn').addEventListener('click', async () => {
    if (!confirm('Are you sure you want to wipe all local tracking data and server logs?')) return;

    const statusDiv = document.getElementById('report');
    statusDiv.innerHTML = '<p style="text-align:center">Wiping data...</p>';

    try {
        // 1. Clear Extension Storage
        await chrome.storage.local.set({ history: [], currentEntry: null });

        // 2. Clear Server Database
        const response = await fetch('http://localhost:5000/clear', {
            method: 'POST'
        });

        if (response.ok) {
            statusDiv.innerHTML = '<p style="text-align:center; color: #28a745;">Success! Everything wiped.</p>';
        } else {
            statusDiv.innerHTML = '<p style="text-align:center; color: #dc3545;">Wiped extension data, but failed to clear server DB.</p>';
        }

        // Reset UI if needed
        setTimeout(() => {
            statusDiv.innerHTML = '';
        }, 2000);

    } catch (err) {
        console.error(err);
        statusDiv.innerHTML = `<p style="color:red; text-align:center">Error during wipe: ${err.message}</p>`;
    }
});

function drawChart(prod, dist) {
    const canvas = document.getElementById('chartCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const total = prod + dist;
    if (total === 0) return;

    const width = canvas.width;
    const height = canvas.height;
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(centerX, centerY) - 10;

    // Clear
    ctx.clearRect(0, 0, width, height);

    let startAngle = 0;

    // Draw Productive Slice (Green)
    const prodAngle = (prod / total) * 2 * Math.PI;
    ctx.fillStyle = '#28a745';
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.arc(centerX, centerY, radius, startAngle, startAngle + prodAngle);
    ctx.closePath();
    ctx.fill();

    startAngle += prodAngle;

    // Draw Distracting Slice (Red)
    const distAngle = (dist / total) * 2 * Math.PI;
    ctx.fillStyle = '#dc3545';
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.arc(centerX, centerY, radius, startAngle, startAngle + distAngle);
    ctx.closePath();
    ctx.fill();

    // White Circle in middle for Donut effect
    ctx.fillStyle = '#f9f9f9'; // Match background
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius * 0.6, 0, 2 * Math.PI);
    ctx.fill();
}

function formatTime(seconds) {
    if (seconds < 60) return Math.floor(seconds) + 's';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}m ${s}s`;
}
