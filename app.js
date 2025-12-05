// State
let stream = null;
let cameraActive = false;
let currentEffect = 'normal';
let accentColor = { r: 0, g: 122, b: 255 };
let intensity = 50;
let brightness = 100;
let contrast = 100;
let frameCount = 0;
let totalFrames = 0;
let lastTime = performance.now();
let fps = 0;
let facingMode = 'user';
let panelOpen = false;
let noiseTime = 0;

// Elements
const video = document.getElementById('video-feed');
const canvas = document.getElementById('canvas-output');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const startContainer = document.getElementById('start-container');
const controlPanel = document.getElementById('control-panel');
const panelExpanded = document.getElementById('panel-expanded');
const expandBtn = document.getElementById('expand-btn');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');

// Initialize canvas and start render loop immediately
function init() {
    canvas.width = 1920;
    canvas.height = 1080;
    document.getElementById('res-value').textContent = '1920×1080';
    requestAnimationFrame(processFrame);
}

// Generate animated noise (optimized with smaller buffer)
function generateNoise() {
    // Use a smaller buffer for performance
    const scale = 4;
    const w = Math.ceil(canvas.width / scale);
    const h = Math.ceil(canvas.height / scale);
    
    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d');
    tempCanvas.width = w;
    tempCanvas.height = h;
    
    const imageData = tempCtx.createImageData(w, h);
    const data = imageData.data;
    noiseTime += 0.02;

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            
            // Flowing noise with multiple frequencies
            const nx = x * 0.02;
            const ny = y * 0.02;
            
            const wave1 = Math.sin(nx + noiseTime) * Math.cos(ny + noiseTime * 0.7);
            const wave2 = Math.sin(nx * 2.5 - noiseTime * 1.3) * Math.cos(ny * 2.5 + noiseTime * 0.5);
            const grain = (Math.random() - 0.5) * 0.3;
            
            const combined = (wave1 * 0.6 + wave2 * 0.3 + grain * 0.1) * 0.5 + 0.5;
            const value = Math.floor(combined * 35 + 8);
            
            data[i] = value;
            data[i + 1] = value;
            data[i + 2] = value + Math.floor(combined * 15); // Blue tint
            data[i + 3] = 255;
        }
    }
    
    tempCtx.putImageData(imageData, 0, 0);
    
    // Scale up to full canvas
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(tempCanvas, 0, 0, canvas.width, canvas.height);
}

// Initialize camera
async function startCamera() {
    // Try with ideal constraints first, then fall back to basic constraints
    const constraints = [
        {
            video: {
                width: { ideal: 1920 },
                height: { ideal: 1080 },
                facingMode: facingMode
            }
        },
        {
            video: {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                facingMode: facingMode
            }
        },
        {
            video: {
                facingMode: facingMode
            }
        },
        {
            video: true
        }
    ];

    let lastError = null;

    for (const constraint of constraints) {
        try {
            stream = await navigator.mediaDevices.getUserMedia(constraint);

            video.srcObject = stream;
            video.style.display = 'block';
            
            // Wait for video to be ready before hiding start button
            await new Promise((resolve, reject) => {
                video.onloadedmetadata = () => {
                    video.play().then(resolve).catch(reject);
                };
                video.onerror = reject;
                // Timeout after 5 seconds
                setTimeout(() => reject(new Error('Video load timeout')), 5000);
            });

            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            document.getElementById('res-value').textContent =
                `${video.videoWidth}×${video.videoHeight}`;
            cameraActive = true;
            
            startContainer.classList.add('hidden');
            statusDot.classList.add('live');
            statusText.textContent = 'Live';
            
            return; // Success, exit the function
        } catch (err) {
            lastError = err;
            console.warn('Camera constraint failed:', constraint, err);
            // Stop any partial stream before trying next constraint
            if (stream) {
                stream.getTracks().forEach(track => track.stop());
                stream = null;
            }
            continue; // Try next constraint
        }
    }

    // All constraints failed
    console.error('All camera constraints failed:', lastError);
    
    // Provide specific error messages
    let message = 'Unable to access camera. ';
    if (lastError) {
        if (lastError.name === 'NotAllowedError' || lastError.name === 'PermissionDeniedError') {
            message += 'Please grant camera permission in your browser settings and try again.';
        } else if (lastError.name === 'NotFoundError' || lastError.name === 'DevicesNotFoundError') {
            message += 'No camera found on this device.';
        } else if (lastError.name === 'NotReadableError' || lastError.name === 'TrackStartError') {
            message += 'Camera may be in use by another application.';
        } else if (lastError.name === 'OverconstrainedError') {
            message += 'Camera does not support the requested settings.';
        } else {
            message += 'Please check your camera and permissions.';
        }
    }
    
    statusText.textContent = 'Error';
    alert(message);
}

// Start on load
init();

// Draggable button with physics
const btnStart = document.getElementById('btn-start');
const statusIndicator = document.getElementById('status-indicator');
const controlPanelEl = document.getElementById('control-panel');
let isDragging = false;
let wasDragged = false;
let dragStartX, dragStartY, initialX, initialY;
let velocityX = 0, velocityY = 0;
let dragLastX, dragLastY, dragLastTime;
let animationId = null;
let posX = window.innerWidth / 2;
let posY = window.innerHeight / 2;
const btnRadius = 100;
const padding = 20;

document.getElementById('btn-start').addEventListener('click', (e) => {
    // Only trigger if not dragging
    if (!isDragging && !wasDragged) {
        startCamera();
    }
});

// Get safe bounds (avoiding UI elements)
function getSafeBounds() {
    const statusRect = statusIndicator.getBoundingClientRect();
    const collapsedBar = document.querySelector('.panel-collapsed');
    const barRect = collapsedBar.getBoundingClientRect();
    
    // Use sensible defaults if elements aren't laid out yet
    const topBound = (statusRect.height > 0) 
        ? statusRect.bottom + btnRadius + padding 
        : btnRadius + 80;
    
    const bottomBound = (barRect.top > 0 && barRect.top < window.innerHeight) 
        ? barRect.top - btnRadius - padding 
        : window.innerHeight - btnRadius - 80;
    
    return {
        left: btnRadius + padding,
        right: window.innerWidth - btnRadius - padding,
        top: topBound,
        bottom: Math.max(bottomBound, topBound + 100) // Ensure there's always room
    };
}

// Clamp position to safe bounds
function clampPosition() {
    const bounds = getSafeBounds();
    posX = Math.max(bounds.left, Math.min(bounds.right, posX));
    posY = Math.max(bounds.top, Math.min(bounds.bottom, posY));
}

// Initialize position
function updateButtonPosition() {
    btnStart.style.left = posX + 'px';
    btnStart.style.top = posY + 'px';
    btnStart.style.transform = 'translate(-50%, -50%)';
}

// Set initial position after a brief delay to ensure layout is complete
requestAnimationFrame(() => {
    posX = window.innerWidth / 2;
    posY = window.innerHeight / 2;
    clampPosition();
    updateButtonPosition();
});

function onDragStart(e) {
    if (animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
    }
    
    isDragging = true;
    wasDragged = false;
    btnStart.classList.add('dragging');
    
    const point = e.touches ? e.touches[0] : e;
    dragStartX = point.clientX;
    dragStartY = point.clientY;
    initialX = posX;
    initialY = posY;
    dragLastX = dragStartX;
    dragLastY = dragStartY;
    dragLastTime = Date.now();
    velocityX = 0;
    velocityY = 0;
}

function onDragMove(e) {
    if (!isDragging) return;
    e.preventDefault();
    
    const point = e.touches ? e.touches[0] : e;
    const dx = point.clientX - dragStartX;
    const dy = point.clientY - dragStartY;
    
    // Mark as dragged if moved more than 5px
    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
        wasDragged = true;
    }
    
    posX = initialX + dx;
    posY = initialY + dy;
    
    // Clamp to safe bounds while dragging
    clampPosition();
    
    // Calculate velocity
    const now = Date.now();
    const dt = now - dragLastTime;
    if (dt > 0) {
        velocityX = (point.clientX - dragLastX) / dt * 16;
        velocityY = (point.clientY - dragLastY) / dt * 16;
    }
    dragLastX = point.clientX;
    dragLastY = point.clientY;
    dragLastTime = now;
    
    updateButtonPosition();
}

function onDragEnd() {
    if (!isDragging) return;
    isDragging = false;
    btnStart.classList.remove('dragging');
    
    // Start physics animation if there's velocity
    if (Math.abs(velocityX) > 0.5 || Math.abs(velocityY) > 0.5) {
        animatePhysics();
    }
    
    // Reset wasDragged after a short delay to allow click to be blocked
    setTimeout(() => {
        wasDragged = false;
    }, 100);
}

function animatePhysics() {
    const friction = 0.95;
    const bounce = 0.6;
    const bounds = getSafeBounds();
    
    velocityX *= friction;
    velocityY *= friction;
    
    posX += velocityX;
    posY += velocityY;
    
    // Bounce off safe bounds
    if (posX < bounds.left) {
        posX = bounds.left;
        velocityX *= -bounce;
    } else if (posX > bounds.right) {
        posX = bounds.right;
        velocityX *= -bounce;
    }
    
    if (posY < bounds.top) {
        posY = bounds.top;
        velocityY *= -bounce;
    } else if (posY > bounds.bottom) {
        posY = bounds.bottom;
        velocityY *= -bounce;
    }
    
    updateButtonPosition();
    
    // Continue animation if still moving
    if (Math.abs(velocityX) > 0.1 || Math.abs(velocityY) > 0.1) {
        animationId = requestAnimationFrame(animatePhysics);
    }
}

// Mouse events
btnStart.addEventListener('mousedown', onDragStart);
document.addEventListener('mousemove', onDragMove);
document.addEventListener('mouseup', onDragEnd);

// Touch events
btnStart.addEventListener('touchstart', onDragStart, { passive: false });
document.addEventListener('touchmove', onDragMove, { passive: false });
document.addEventListener('touchend', onDragEnd);

// Handle window resize
window.addEventListener('resize', () => {
    clampPosition();
    updateButtonPosition();
});

// Panel expand/collapse
expandBtn.addEventListener('click', () => {
    panelOpen = !panelOpen;
    panelExpanded.classList.toggle('open', panelOpen);
    expandBtn.classList.toggle('open', panelOpen);
});

// Close panel when clicking outside
document.addEventListener('click', (e) => {
    if (panelOpen && !e.target.closest('.control-panel')) {
        panelOpen = false;
        panelExpanded.classList.remove('open');
        expandBtn.classList.remove('open');
    }
});

// Flip camera
document.getElementById('flip-btn').addEventListener('click', async () => {
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
        cameraActive = false;
    }
    facingMode = facingMode === 'user' ? 'environment' : 'user';
    await startCamera();
});

// Effect buttons
document.querySelectorAll('.effect-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.effect-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentEffect = btn.dataset.effect;
        document.getElementById('current-effect').textContent =
            currentEffect.charAt(0).toUpperCase() + currentEffect.slice(1);
    });
});

// Color picker
const colorInput = document.getElementById('color-input');
const colorBar = document.getElementById('color-bar');
const colorHex = document.getElementById('color-hex');

function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : { r: 0, g: 122, b: 255 };
}

function getLuminance(r, g, b) {
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

function updateColorBar(hex) {
    colorBar.style.background = hex;
    colorHex.textContent = hex.toUpperCase();
    accentColor = hexToRgb(hex);
    
    // Adjust text color based on background luminance
    const luminance = getLuminance(accentColor.r, accentColor.g, accentColor.b);
    const textColor = luminance > 0.5 ? 'rgba(0,0,0,0.8)' : 'rgba(255,255,255,0.95)';
    const iconBg = luminance > 0.5 ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.25)';
    
    colorBar.style.color = textColor;
    colorBar.querySelector('.color-bar-icon').style.background = iconBg;
    colorBar.querySelector('.color-bar-icon svg').style.fill = textColor;
}

colorInput.addEventListener('input', (e) => {
    updateColorBar(e.target.value);
});

// Initialize color bar
updateColorBar('#007AFF');

// Sliders
document.getElementById('intensity').addEventListener('input', (e) => {
    intensity = parseInt(e.target.value);
    document.getElementById('intensity-value').textContent = intensity + '%';
});

document.getElementById('brightness').addEventListener('input', (e) => {
    brightness = parseInt(e.target.value);
    document.getElementById('brightness-value').textContent = brightness + '%';
});

document.getElementById('contrast').addEventListener('input', (e) => {
    contrast = parseInt(e.target.value);
    document.getElementById('contrast-value').textContent = contrast + '%';
});

// Capture button
document.getElementById('capture-btn').addEventListener('click', () => {
    const flash = document.getElementById('capture-flash');
    flash.classList.add('flash');
    setTimeout(() => flash.classList.remove('flash'), 100);

    const link = document.createElement('a');
    link.download = `vision-${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
});

// Main processing loop
function processFrame() {
    frameCount++;
    totalFrames++;
    const now = performance.now();
    if (now - lastTime >= 1000) {
        fps = frameCount;
        frameCount = 0;
        lastTime = now;
        document.getElementById('fps-value').textContent = fps;
        document.getElementById('fps-display').textContent = fps;
    }
    document.getElementById('frames-value').textContent = totalFrames;

    // Draw source: either camera or animated noise
    if (cameraActive && stream) {
        ctx.save();
        if (facingMode === 'user') {
            ctx.scale(-1, 1);
            ctx.drawImage(video, -canvas.width, 0, canvas.width, canvas.height);
        } else {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        }
        ctx.restore();
    } else {
        generateNoise();
    }

    // Brightness/contrast
    if (brightness !== 100 || contrast !== 100) {
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        
        // Convert contrast from 50-150 range to -127.5 to 127.5 range (where 0 = no change)
        const contrastAdjusted = (contrast - 100) * 2.55;
        const factor = (259 * (contrastAdjusted + 255)) / (255 * (259 - contrastAdjusted));
        const brightnessAdjusted = brightness / 100;

        for (let i = 0; i < data.length; i += 4) {
            // Apply brightness first, then contrast
            data[i] = clamp(factor * (data[i] * brightnessAdjusted - 128) + 128);
            data[i + 1] = clamp(factor * (data[i + 1] * brightnessAdjusted - 128) + 128);
            data[i + 2] = clamp(factor * (data[i + 2] * brightnessAdjusted - 128) + 128);
        }
        ctx.putImageData(imageData, 0, 0);
    }

    // Apply effect
    switch (currentEffect) {
        case 'aura': applyAura(); break;
        case 'thermal': applyThermal(); break;
        case 'glitch': applyGlitch(); break;
        case 'pixelate': applyPixelate(); break;
        case 'edge': applyEdgeDetection(); break;
        case 'ascii': applyAscii(); break;
        case 'mirror': applyKaleidoscope(); break;
    }

    requestAnimationFrame(processFrame);
}

function clamp(val) {
    return Math.max(0, Math.min(255, val));
}

function applyAura() {
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    const strength = intensity / 100;

    for (let i = 0; i < data.length; i += 4) {
        const luminance = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255;
        const auraStrength = Math.pow(luminance, 2) * strength;

        data[i] = clamp(data[i] + accentColor.r * auraStrength * 0.5);
        data[i + 1] = clamp(data[i + 1] + accentColor.g * auraStrength * 0.5);
        data[i + 2] = clamp(data[i + 2] + accentColor.b * auraStrength * 0.5);
    }

    ctx.putImageData(imageData, 0, 0);

    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = `rgba(${accentColor.r}, ${accentColor.g}, ${accentColor.b}, ${0.1 * strength})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = 'source-over';
}

function applyThermal() {
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    const strength = intensity / 100;

    for (let i = 0; i < data.length; i += 4) {
        const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
        const normalized = avg / 255;

        let r, g, b;
        if (normalized < 0.25) {
            r = 0; g = normalized * 4 * 255; b = 255;
        } else if (normalized < 0.5) {
            r = 0; g = 255; b = (1 - (normalized - 0.25) * 4) * 255;
        } else if (normalized < 0.75) {
            r = (normalized - 0.5) * 4 * 255; g = 255; b = 0;
        } else {
            r = 255; g = (1 - (normalized - 0.75) * 4) * 255; b = 0;
        }

        data[i] = clamp(data[i] * (1 - strength) + r * strength);
        data[i + 1] = clamp(data[i + 1] * (1 - strength) + g * strength);
        data[i + 2] = clamp(data[i + 2] * (1 - strength) + b * strength);
    }

    ctx.putImageData(imageData, 0, 0);
}

function applyGlitch() {
    const strength = intensity / 100;
    const sliceCount = Math.floor(5 + strength * 15);

    for (let i = 0; i < sliceCount; i++) {
        if (Math.random() > 0.7) {
            const y = Math.random() * canvas.height;
            const height = Math.random() * 30 + 5;
            const offset = (Math.random() - 0.5) * 50 * strength;

            const slice = ctx.getImageData(0, y, canvas.width, height);
            ctx.putImageData(slice, offset, y);
        }
    }

    if (Math.random() > 0.5) {
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        const shift = Math.floor(strength * 10);

        for (let y = 0; y < canvas.height; y++) {
            for (let x = 0; x < canvas.width; x++) {
                const i = (y * canvas.width + x) * 4;
                const shiftedI = (y * canvas.width + Math.min(x + shift, canvas.width - 1)) * 4;
                data[i] = data[shiftedI];
            }
        }
        ctx.putImageData(imageData, 0, 0);
    }
}

function applyPixelate() {
    const size = Math.max(2, Math.floor(2 + (intensity / 100) * 30));

    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d');
    tempCanvas.width = Math.ceil(canvas.width / size);
    tempCanvas.height = Math.ceil(canvas.height / size);

    tempCtx.drawImage(canvas, 0, 0, tempCanvas.width, tempCanvas.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tempCanvas, 0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;
}

function applyEdgeDetection() {
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    const width = canvas.width;
    const height = canvas.height;
    const output = new Uint8ClampedArray(data.length);
    const strength = intensity / 100;

    const sobelX = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
    const sobelY = [-1, -2, -1, 0, 0, 0, 1, 2, 1];

    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            let gx = 0, gy = 0;

            for (let ky = -1; ky <= 1; ky++) {
                for (let kx = -1; kx <= 1; kx++) {
                    const idx = ((y + ky) * width + (x + kx)) * 4;
                    const gray = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
                    const ki = (ky + 1) * 3 + (kx + 1);
                    gx += gray * sobelX[ki];
                    gy += gray * sobelY[ki];
                }
            }

            const magnitude = Math.sqrt(gx * gx + gy * gy);
            const i = (y * width + x) * 4;

            const edgeVal = clamp(magnitude * strength);
            output[i] = data[i] * (1 - strength) + (accentColor.r * edgeVal / 255) * strength;
            output[i + 1] = data[i + 1] * (1 - strength) + (accentColor.g * edgeVal / 255) * strength;
            output[i + 2] = data[i + 2] * (1 - strength) + (accentColor.b * edgeVal / 255) * strength;
            output[i + 3] = 255;
        }
    }

    ctx.putImageData(new ImageData(output, width, height), 0, 0);
}

function applyAscii() {
    const chars = ' .:-=+*#%@';
    const fontSize = Math.max(4, 16 - Math.floor(intensity / 10));

    // Store current canvas content
    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d');
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    tempCtx.drawImage(canvas, 0, 0);

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const cols = Math.floor(canvas.width / fontSize);
    const rows = Math.floor(canvas.height / fontSize);

    ctx.font = `${fontSize}px monospace`;
    ctx.fillStyle = `rgb(${accentColor.r}, ${accentColor.g}, ${accentColor.b})`;
    ctx.textBaseline = 'top';

    const imageData = tempCtx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            const px = Math.floor(x * fontSize + fontSize / 2);
            const py = Math.floor(y * fontSize + fontSize / 2);
            const i = (py * canvas.width + px) * 4;

            const bright = (data[i] + data[i + 1] + data[i + 2]) / 3;
            const charIndex = Math.floor((bright / 255) * (chars.length - 1));

            ctx.fillText(chars[charIndex], x * fontSize, y * fontSize);
        }
    }
}

function applyKaleidoscope() {
    const segments = Math.max(4, Math.floor(4 + (intensity / 100) * 12));
    const angleStep = (Math.PI * 2) / segments;
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;

    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d');
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    tempCtx.drawImage(canvas, 0, 0);

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (let i = 0; i < segments; i++) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(angleStep * i);

        if (i % 2 === 1) {
            ctx.scale(-1, 1);
        }

        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, Math.max(cx, cy) * 1.5, -angleStep / 2, angleStep / 2);
        ctx.closePath();
        ctx.clip();

        ctx.drawImage(tempCanvas, -cx, -cy);
        ctx.restore();
    }

    ctx.globalCompositeOperation = 'overlay';
    ctx.fillStyle = `rgba(${accentColor.r}, ${accentColor.g}, ${accentColor.b}, 0.1)`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = 'source-over';
}
