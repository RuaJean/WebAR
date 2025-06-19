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

// Asegúrate de incluir en tu HTML:
// <script src="https://unpkg.com/three@0.152.0/build/three.min.js"></script>
// <script src="https://unpkg.com/three@0.152.0/examples/js/loaders/GLTFLoader.js"></script>
// <script src="path/to/Cesium.js"></script>
// <script src="path/to/webxr-geospatial.js"></script>

(async function() {
  const isArSessionSupported = navigator.xr && navigator.xr.isSessionSupported &&
    await navigator.xr.isSessionSupported('immersive-ar');

  if (isArSessionSupported) {
    const btn = document.getElementById('enter-ar');
    btn && btn.addEventListener('click', () => {
      // Aseguramos que window.app ya esté definido cuando el usuario hace clic
      window.app.activateXR();
    });
  } else {
    onNoXRDevice();
  }
})();

class App {
  // Update coordinates constants and add helpers
  static TARGET_LAT = 6 + 16/60 + 58/3600; // grados
  static TARGET_LON = -(75 + 37/60 + 15/3600); // grados (oeste negativo)
  static TARGET_ALT = 1926; // metros

  /**
   * Convierte diferencia lat/lon (en grados) a metros aproximados usando
   * la proyección equirectangular (suficiente para distancias < 1-2 km).
   */
  _latLonToMeters(dLatDeg, dLonDeg, lat0Deg) {
    const R = 6378137; // Radio WGS84
    const dLat = THREE.MathUtils.degToRad(dLatDeg);
    const dLon = THREE.MathUtils.degToRad(dLonDeg);
    const lat0 = THREE.MathUtils.degToRad(lat0Deg);
    const x = dLon * Math.cos(lat0) * R; // Este (+X)
    const z = dLat * R;                  // Norte (+Z)
    return new THREE.Vector3(x, 0, z);
  }

  activateXR = async () => {
    console.info('activateXR: iniciando solicitud de sesión XR');
    try {
      this.xrSession = await navigator.xr.requestSession('immersive-ar', {
        requiredFeatures: ['hit-test', 'dom-overlay', 'local'],
        geolocation: true,
        alignEUS: 'y',
        domOverlay: { root: document.body }
      });
      console.info('activateXR: XRSession creada');

      this.createXRCanvas();
      await this.onSessionStarted();
    } catch (e) {
      console.error('activateXR error', e);
      onNoXRDevice();
    }
  }

  createXRCanvas() {
    console.debug('createXRCanvas');
    this.canvas = document.createElement('canvas');
    document.body.appendChild(this.canvas);
    this.gl = this.canvas.getContext('webgl', { xrCompatible: true });

    this.xrSession.updateRenderState({
      baseLayer: new XRWebGLLayer(this.xrSession, this.gl)
    });
  }

  onSessionStarted = async () => {
    document.body.classList.add('ar');

    this.setupThreeJs();

    // Referencias de espacio y hit-test
    this.localReferenceSpace = await this.xrSession.requestReferenceSpace('local');
    this.viewerSpace = await this.xrSession.requestReferenceSpace('viewer');
    this.hitTestSource = await this.xrSession.requestHitTestSource({ space: this.viewerSpace });

    // Paso 1: obtener ubicación del usuario UNA sola vez
    this.gpsReady = false;
    navigator.geolocation.getCurrentPosition((pos)=>{
      const userLat = pos.coords.latitude;
      const userLon = pos.coords.longitude;
      const userAlt = pos.coords.altitude || 0;
      console.info('[GPS] Posición usuario:', {
        lat:userLat, lon:userLon, alt:userAlt,
        accuracy: pos.coords.accuracy, altAcc: pos.coords.altitudeAccuracy
      });

      const dLat = App.TARGET_LAT - userLat;
      const dLon = App.TARGET_LON - userLon;
      const horizontal = this._latLonToMeters(dLat, dLon, userLat);
      const dAlt = App.TARGET_ALT - userAlt;
      horizontal.y = dAlt;
      // Guardamos desplazamiento EN metros respecto al punto de inicio
      this.targetOffset = horizontal; // Vector3 (X este, Y arriba, Z norte)
      this.gpsReady = true;
      console.info('[GPS] Offset ENU objetivo (m):', horizontal);
    }, (e)=>{
      console.error('Error GPS:', e);
      this.gpsReady = false; // seguiremos esperando retículo y usuario podrá tocar
    }, { enableHighAccuracy:true, timeout:5000 });

    // Cargar el modelo 3D de la casa de madera
    const loader = new THREE.GLTFLoader();
    loader.load('assets/wooden_house/scene.gltf', (gltf) => {
      this.model = gltf.scene;
      // Ajusta la escala si es necesario. Este valor es un punto de partida.
      this.model.scale.set(0.1, 0.1, 0.1);
      this.model.traverse((c)=>{ c.castShadow = true; c.receiveShadow = true; });
      this.model.matrixAutoUpdate = true;
      this.scene.add(this.model);
      console.log('Modelo de casa de madera cargado.');
    }, (xhr) => {
      console.debug(`Cargando GLTF... ${(xhr.loaded/xhr.total*100).toFixed(1)}%`);
    }, (err) => {
      console.error('Error cargando GLTF', err);
    });

    // Iniciar loop de render
    this.xrSession.requestAnimationFrame(this.onXRFrame);
    this.xrSession.addEventListener('select', this.onSelect);
  }

  onSelect = () => {
    // Ejemplo: clonar modelo en la posición actual del ancla
    if (this.model) {
      const clone = this.model.clone();
      clone.matrix.copy(this.model.matrix);
      clone.matrixAutoUpdate = false;
      this.scene.add(clone);
    }
  }

  onXRFrame = (time, frame) => {
    if(!this._frameCount){this._frameCount=0;} if(!(this._frameCount++ % 60)){ console.debug('onXRFrame tick 60'); }
    this.xrSession.requestAnimationFrame(this.onXRFrame);

    const framebuffer = this.xrSession.renderState.baseLayer.framebuffer;
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, framebuffer);
    this.renderer.setFramebuffer(framebuffer);

    const pose = frame.getViewerPose(this.localReferenceSpace);
    if (pose) {
      const view = pose.views[0];
      const viewport = this.xrSession.renderState.baseLayer.getViewport(view);
      this.renderer.setSize(viewport.width, viewport.height);

      this.camera.matrix.fromArray(view.transform.matrix);
      this.camera.projectionMatrix.fromArray(view.projectionMatrix);
      this.camera.updateMatrixWorld(true);

      // Hit-test para retículo (opcional)
      const hits = frame.getHitTestResults(this.hitTestSource);
      if (!this.stabilized && hits.length) {
        this.stabilized = true;
        document.body.classList.add('stabilized');
      }
      if (hits.length) {
        const hitPose = hits[0].getPose(this.localReferenceSpace);
        // Si ya tenemos geo ancla no necesitamos mostrar retículo
        this.reticle.visible = !(this.gpsReady);
        this.reticle.position.set(
          hitPose.transform.position.x,
          hitPose.transform.position.y,
          hitPose.transform.position.z
        );
        this.reticle.updateMatrixWorld(true);

        // Si aún no hemos colocado modelo y tenemos GPS + retículo
        if (!this.modelPlaced && this.gpsReady && hits.length && this.model) {
          const hitPose = hits[0].getPose(this.localReferenceSpace);
          // Tomamos la base (suelo bajo el usuario)
          const basePos = new THREE.Vector3(
            hitPose.transform.position.x,
            hitPose.transform.position.y,
            hitPose.transform.position.z);

          // Construimos ejes ENU locales a partir de cámara (Right = +X Este, Forward = -Z Norte)
          const camMatrix = new THREE.Matrix4().fromArray(view.transform.matrix);
          const camOrigin = new THREE.Vector3().setFromMatrixPosition(camMatrix);
          const camRight = new THREE.Vector3(1,0,0).applyMatrix4(camMatrix).sub(camOrigin).setY(0).normalize();
          const camForward = new THREE.Vector3(0,0,-1).applyMatrix4(camMatrix).sub(camOrigin).setY(0).normalize();

          // Proyecto offset en sistema local
          const offsetWorld = camRight.clone().multiplyScalar(this.targetOffset.x)  // Este
                                .add(camForward.clone().multiplyScalar(-this.targetOffset.z)) // Norte -> -Z
                                .setY(this.targetOffset.y);

          const finalPos = basePos.clone().add(offsetWorld);
          this.model.position.copy(finalPos);
          this.model.updateMatrixWorld(true);
          this.modelPlaced = true;
          console.info('[Placement] base', basePos, 'offsetWorld', offsetWorld, 'final', finalPos);
        }
      }

      console.trace('[Frame] hits:', hits.length, 'stabilized:', this.stabilized);

      this.renderer.render(this.scene, this.camera);
    }
  }

  setupThreeJs() {
    this.renderer = new THREE.WebGLRenderer({
      alpha: true,
      preserveDrawingBuffer: true,
      canvas: this.canvas,
      context: this.gl
    });
    this.renderer.autoClear = false;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = DemoUtils.createLitScene();
    this.reticle = new Reticle();
    this.scene.add(this.reticle);

    this.camera = new THREE.PerspectiveCamera();
    this.camera.matrixAutoUpdate = false;
  }
}

window.app = new App();
