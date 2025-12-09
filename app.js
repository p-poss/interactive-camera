// State
let stream = null;
let cameraActive = false;
let currentEffect = 'ascii';
let accentColor = { r: 0, g: 122, b: 255 };
let baseHue = 210; // Default blue hue
let intensity = 100;
let brightness = 100;
let contrast = 100;
let frameCount = 0;
let totalFrames = 0;
let lastTime = performance.now();
let fps = 0;
let facingMode = 'user';
let panelOpen = false;
let noiseTime = 0;

// Interactive features state
let colorShiftEnabled = false;
let blinkInvertEnabled = false;
let faceDetector = null;
let headTiltAngle = 0;

// Blink detection state
let blinkCooldown = false;
let lastEAR = 1;
let eyesWereClosed = false;

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

// Interactive toggles
document.getElementById('color-shift-btn').addEventListener('click', async () => {
    colorShiftEnabled = !colorShiftEnabled;
    document.getElementById('color-shift-btn').classList.toggle('active', colorShiftEnabled);

    if (colorShiftEnabled && !faceDetector) {
        await initFaceDetection();
    }
});

document.getElementById('blink-invert-btn').addEventListener('click', async () => {
    blinkInvertEnabled = !blinkInvertEnabled;
    document.getElementById('blink-invert-btn').classList.toggle('active', blinkInvertEnabled);

    if (blinkInvertEnabled && !faceDetector) {
        await initFaceDetection();
    }
});

// Face mesh initialization
let faceMeshReady = false;

async function initFaceDetection() {
    if (typeof FaceMesh === 'undefined') {
        console.warn('MediaPipe Face Mesh not loaded');
        return;
    }

    try {
        faceDetector = new FaceMesh({
            locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
        });

        faceDetector.setOptions({
            maxNumFaces: 1,
            refineLandmarks: true,
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5
        });

        faceDetector.onResults((results) => {
            faceMeshReady = true;
            onFaceResults(results);
        });

        console.log('Face mesh initialized, waiting for first detection...');
    } catch (err) {
        console.error('Failed to initialize face mesh:', err);
        faceDetector = null;
    }
}

// Process face mesh results
function onFaceResults(results) {
    if (!colorShiftEnabled && !blinkInvertEnabled) return;

    if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
        const landmarks = results.multiFaceLandmarks[0];

        // Head tilt detection using eye positions
        if (colorShiftEnabled) {
            // Use eye corners for tilt: left eye outer (263), right eye outer (33)
            const leftEyeOuter = landmarks[263];
            const rightEyeOuter = landmarks[33];

            const deltaY = leftEyeOuter.y - rightEyeOuter.y;
            const deltaX = leftEyeOuter.x - rightEyeOuter.x;
            const angle = Math.atan2(deltaY, deltaX) * (180 / Math.PI);

            headTiltAngle = headTiltAngle * 0.7 + angle * 0.3;

            // Require more tilt (-60 to +60 degrees) to reach full color range
            const normalizedTilt = Math.max(-60, Math.min(60, headTiltAngle));
            const hue = ((normalizedTilt + 60) / 120) * 360;

            updateAccentColorFromHue(hue);
        }

        // Blink detection using Eye Aspect Ratio (EAR)
        if (blinkInvertEnabled) {
            detectBlinkEAR(landmarks);
        }
    }
}

// Calculate Eye Aspect Ratio (EAR) for blink detection
function calculateEAR(landmarks, eyeIndices) {
    // eyeIndices: [p1, p2, p3, p4, p5, p6] - points around the eye
    // EAR = (|p2-p6| + |p3-p5|) / (2 * |p1-p4|)
    const p1 = landmarks[eyeIndices[0]];
    const p2 = landmarks[eyeIndices[1]];
    const p3 = landmarks[eyeIndices[2]];
    const p4 = landmarks[eyeIndices[3]];
    const p5 = landmarks[eyeIndices[4]];
    const p6 = landmarks[eyeIndices[5]];

    const vertical1 = Math.sqrt(Math.pow(p2.x - p6.x, 2) + Math.pow(p2.y - p6.y, 2));
    const vertical2 = Math.sqrt(Math.pow(p3.x - p5.x, 2) + Math.pow(p3.y - p5.y, 2));
    const horizontal = Math.sqrt(Math.pow(p1.x - p4.x, 2) + Math.pow(p1.y - p4.y, 2));

    if (horizontal === 0) return 1;
    return (vertical1 + vertical2) / (2 * horizontal);
}

// Detect blinks using Eye Aspect Ratio
function detectBlinkEAR(landmarks) {
    if (blinkCooldown) return;

    // Face Mesh eye landmark indices for EAR calculation
    // Right eye: outer corner(33), top(159), top(158), inner corner(133), bottom(153), bottom(145)
    // Left eye: inner corner(362), top(386), top(385), outer corner(263), bottom(380), bottom(374)
    const rightEyeIndices = [33, 159, 158, 133, 153, 145];
    const leftEyeIndices = [362, 386, 385, 263, 380, 374];

    const rightEAR = calculateEAR(landmarks, rightEyeIndices);
    const leftEAR = calculateEAR(landmarks, leftEyeIndices);
    const avgEAR = (rightEAR + leftEAR) / 2;

    // Higher threshold = more sensitive (0.25 catches more blinks)
    const EAR_THRESHOLD = 0.25;

    if (avgEAR < EAR_THRESHOLD && lastEAR >= EAR_THRESHOLD) {
        // Eyes just closed - trigger immediately on the closing edge
        invertAccentColor();
        blinkCooldown = true;
        setTimeout(() => { blinkCooldown = false; }, 400);
    }

    lastEAR = avgEAR;
}

// Invert the accent color
function invertAccentColor() {
    accentColor = {
        r: 255 - accentColor.r,
        g: 255 - accentColor.g,
        b: 255 - accentColor.b
    };

    // Update color bar UI
    const hex = `#${accentColor.r.toString(16).padStart(2, '0')}${accentColor.g.toString(16).padStart(2, '0')}${accentColor.b.toString(16).padStart(2, '0')}`;
    colorBar.style.background = hex;
    colorHex.textContent = hex.toUpperCase();
    colorInput.value = hex;

    const luminance = getLuminance(accentColor.r, accentColor.g, accentColor.b);
    const textColor = luminance > 0.5 ? 'rgba(0,0,0,0.8)' : 'rgba(255,255,255,0.95)';
    const iconBg = luminance > 0.5 ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.25)';
    colorBar.style.color = textColor;
    colorBar.querySelector('.color-bar-icon').style.background = iconBg;
    colorBar.querySelector('.color-bar-icon svg').style.fill = textColor;
}

// Convert HSL hue to RGB and update accent color
function updateAccentColorFromHue(hue) {
    const s = 1.0; // Full saturation
    const l = 0.5; // Medium lightness

    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs((hue / 60) % 2 - 1));
    const m = l - c / 2;

    let r, g, b;
    if (hue < 60) { r = c; g = x; b = 0; }
    else if (hue < 120) { r = x; g = c; b = 0; }
    else if (hue < 180) { r = 0; g = c; b = x; }
    else if (hue < 240) { r = 0; g = x; b = c; }
    else if (hue < 300) { r = x; g = 0; b = c; }
    else { r = c; g = 0; b = x; }

    accentColor = {
        r: Math.round((r + m) * 255),
        g: Math.round((g + m) * 255),
        b: Math.round((b + m) * 255)
    };

    // Update color bar UI
    const hex = `#${accentColor.r.toString(16).padStart(2, '0')}${accentColor.g.toString(16).padStart(2, '0')}${accentColor.b.toString(16).padStart(2, '0')}`;
    colorBar.style.background = hex;
    colorHex.textContent = hex.toUpperCase();
    colorInput.value = hex;

    const luminance = getLuminance(accentColor.r, accentColor.g, accentColor.b);
    const textColor = luminance > 0.5 ? 'rgba(0,0,0,0.8)' : 'rgba(255,255,255,0.95)';
    const iconBg = luminance > 0.5 ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.25)';
    colorBar.style.color = textColor;
    colorBar.querySelector('.color-bar-icon').style.background = iconBg;
    colorBar.querySelector('.color-bar-icon svg').style.fill = textColor;
}

// Run face detection on video frame
let faceDetectionPending = false;

async function runFaceDetection() {
    if ((!colorShiftEnabled && !blinkInvertEnabled) || !faceDetector || !cameraActive || video.readyState < 2) {
        return;
    }

    // Prevent overlapping detections
    if (faceDetectionPending) return;
    faceDetectionPending = true;

    try {
        await faceDetector.send({ image: video });
    } catch (err) {
        console.error('Face detection error:', err);
    } finally {
        faceDetectionPending = false;
    }
}

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

        // Run face detection for interactive features (every frame for responsiveness)
        if (colorShiftEnabled || blinkInvertEnabled) {
            runFaceDetection();
        }
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
        case 'edge': applyEdgeDetection(); break;
        case 'ascii': applyAscii(); break;
    }

    requestAnimationFrame(processFrame);
}

function clamp(val) {
    return Math.max(0, Math.min(255, val));
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
