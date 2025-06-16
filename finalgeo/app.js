/*
 * Copyright 2017 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the 'License');
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an 'AS IS' BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Query for WebXR support. If there's no support for the `immersive-ar` mode,
 * show an error.
 */
(async function() {
  if (!navigator.xr) {
    onNoXRDevice();
    return;
  }

  const isArSessionSupported = await navigator.xr.isSessionSupported("immersive-ar");
  if (!isArSessionSupported) {
    onNoXRDevice();
    return;
  }

  // The Geospatial API is available, so we can start the AR experience.
  // We'll check for availability and handle errors in activateXR().
  document.getElementById("enter-ar").addEventListener("click", window.app.activateXR);
})();

/**
 * Container class to manage connecting to the WebXR Device API
 * and handle rendering on every frame.
 */
class App {
  /**
   * Run when the Start AR button is pressed.
   */
  activateXR = async () => {
    try {
      // Initialize a WebXR session using "immersive-ar".
      // We're changing the required features to 'geospatial' and 'local'
      // to use the Geospatial API.
      this.xrSession = await navigator.xr.requestSession("immersive-ar", {
        requiredFeatures: ['geospatial', 'local'],
        domOverlay: { root: document.body }
      });

      // Create the canvas that will contain our camera's background and our virtual scene.
      this.createXRCanvas();

      // With everything set up, start the app.
      await this.onSessionStarted();
    } catch(e) {
      console.error(e);
      onNoXRDevice();
    }
  }

  /**
   * Add a canvas element and initialize a WebGL context that is compatible with WebXR.
   */
  createXRCanvas() {
    this.canvas = document.createElement("canvas");
    document.body.appendChild(this.canvas);
    this.gl = this.canvas.getContext("webgl", {xrCompatible: true});

    this.xrSession.updateRenderState({
      baseLayer: new XRWebGLLayer(this.xrSession, this.gl)
    });
  }

  /**
   * Called when the XRSession has begun. Here we set up our three.js
   * renderer, scene, and camera and attach our XRWebGLLayer to the
   * XRSession and kick off the render loop.
   */
  onSessionStarted = async () => {
    // Add the `ar` class to our body, which will hide our 2D components
    document.body.classList.add('ar');

    // To help with working with 3D on the web, we'll use three.js.
    this.setupThreeJs();

    // Setup an XRReferenceSpace using the "local" coordinate system.
    // The 'local' reference space is aligned with the 'geospatial' one.
    this.localReferenceSpace = await this.xrSession.requestReferenceSpace('local');

    // Place the object using geolocation.
    this.placeObjectGeospatially();

    // Start a rendering loop using this.onXRFrame.
    this.xrSession.requestAnimationFrame(this.onXRFrame);
  }

  /**
   * Uses the browser's Geolocation API to calculate the position of the 3D model
   * based on the provided geographic coordinates and the user's current location.
   */
  placeObjectGeospatially = () => {
    const modelLatitude = 6.2825;
    const modelLongitude = -75.620556;
    const modelAltitude = 1917; // in meters

    const toRadians = (deg) => deg * Math.PI / 180;

    const haversineDistance = (coords1, coords2) => {
      const R = 6371e3; // Earth's radius in metres
      const lat1 = toRadians(coords1.latitude);
      const lat2 = toRadians(coords2.latitude);
      const deltaLat = toRadians(coords2.latitude - coords1.latitude);
      const deltaLon = toRadians(coords2.longitude - coords1.longitude);

      const a = Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
                Math.cos(lat1) * Math.cos(lat2) *
                Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return R * c;
    };

    const calculateBearing = (coords1, coords2) => {
      const lat1 = toRadians(coords1.latitude);
      const lon1 = toRadians(coords1.longitude);
      const lat2 = toRadians(coords2.latitude);
      const lon2 = toRadians(coords2.longitude);
      const deltaLon = lon2 - lon1;

      const y = Math.sin(deltaLon) * Math.cos(lat2);
      const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon);
      return Math.atan2(y, x);
    };

    navigator.geolocation.getCurrentPosition(position => {
      const userCoords = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        altitude: position.coords.altitude || 0
      };

      const modelCoords = { latitude: modelLatitude, longitude: modelLongitude, altitude: modelAltitude };

      const distance = haversineDistance(userCoords, modelCoords);
      const bearing = calculateBearing(userCoords, modelCoords);
      const altitudeDifference = modelCoords.altitude - userCoords.altitude;

      const x = distance * Math.sin(bearing);
      const z = -distance * Math.cos(bearing);
      const y = altitudeDifference;

      if (window.sunflower) {
        const clone = window.sunflower.clone();
        clone.position.set(x, y, z);
        this.scene.add(clone);

        const shadowMesh = this.scene.children.find(c => c.name === 'shadowMesh');
        if (shadowMesh) {
          shadowMesh.position.y = clone.position.y;
        }

        this.stabilized = true;
        document.body.classList.add('stabilized');
      }
    }, error => {
      console.error("Error getting user's location:", error);
      // You could show an error message to the user here.
    }, { enableHighAccuracy: true });
  }

  /**
   * Called on the XRSession's requestAnimationFrame.
   * Called with the time and XRPresentationFrame.
   */
  onXRFrame = (time, frame) => {
    // Queue up the next draw request.
    this.xrSession.requestAnimationFrame(this.onXRFrame);

    // Bind the graphics framebuffer to the baseLayer's framebuffer.
    const framebuffer = this.xrSession.renderState.baseLayer.framebuffer
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, framebuffer)
    this.renderer.setFramebuffer(framebuffer);

    // Retrieve the pose of the device.
    // XRFrame.getViewerPose can return null while the session attempts to establish tracking.
    const pose = frame.getViewerPose(this.localReferenceSpace);
    if (pose) {
      // In mobile AR, we only have one view.
      const view = pose.views[0];

      const viewport = this.xrSession.renderState.baseLayer.getViewport(view);
      this.renderer.setSize(viewport.width, viewport.height)

      // Use the view's transform matrix and projection matrix to configure the THREE.camera.
      this.camera.matrix.fromArray(view.transform.matrix)
      this.camera.projectionMatrix.fromArray(view.projectionMatrix);
      this.camera.updateMatrixWorld(true);

      // Render the scene with THREE.WebGLRenderer.
      this.renderer.render(this.scene, this.camera)
    }
  }

  /**
   * Initialize three.js specific rendering code, including a WebGLRenderer,
   * a demo scene, and a camera for viewing the 3D content.
   */
  setupThreeJs() {
    // To help with working with 3D on the web, we'll use three.js.
    // Set up the WebGLRenderer, which handles rendering to our session's base layer.
    this.renderer = new THREE.WebGLRenderer({
      alpha: true,
      preserveDrawingBuffer: true,
      canvas: this.canvas,
      context: this.gl
    });
    this.renderer.autoClear = false;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Initialize our demo scene.
    this.scene = DemoUtils.createLitScene();

    // We'll update the camera matrices directly from API, so
    // disable matrix auto updates so three.js doesn't attempt
    // to handle the matrices independently.
    this.camera = new THREE.PerspectiveCamera();
    this.camera.matrixAutoUpdate = false;
  }
};

window.app = new App();