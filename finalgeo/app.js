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
  // Coordenadas geográficas deseadas
  static GEO_LAT = Cesium.Math.toRadians(6 + 16/60 + 58/3600);       // 6°16'58"N
  static GEO_LON = Cesium.Math.toRadians(-(75 + 37/60 + 15/3600));     // 75°37'15"W
  static GEO_ALT = 1926;                                              // metros

  activateXR = async () => {
    try {
      this.xrSession = await navigator.xr.requestSession('immersive-ar', {
        requiredFeatures: ['hit-test', 'dom-overlay', 'local'],
        geolocation: true,
        alignEUS: 'y',
        domOverlay: { root: document.body }
      });

      this.createXRCanvas();
      await this.onSessionStarted();
    } catch (e) {
      console.error(e);
      onNoXRDevice();
    }
  }

  createXRCanvas() {
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

    // Referencias de espacio
    this.localReferenceSpace = await this.xrSession.requestReferenceSpace('local');
    this.viewerSpace = await this.xrSession.requestReferenceSpace('viewer');
    this.hitTestSource = await this.xrSession.requestHitTestSource({ space: this.viewerSpace });

    this.geoReady = false;
    this.anchorReferenceSpace = this.localReferenceSpace; // por defecto

    try {
      console.log('Solicitando referenceSpace geospatial…');
      this.geoReferenceSpace = await this.xrSession.requestReferenceSpace('geospatial');
      this.anchorReferenceSpace = this.geoReferenceSpace;

      const carto = new Cesium.Cartographic(
        App.GEO_LON,
        App.GEO_LAT,
        App.GEO_ALT
      );
      if (window.XRGeospatialAnchor && carto) {
        console.log('Creando XRGeospatialAnchor…');
        this.geoAnchor = await XRGeospatialAnchor.createGeoAnchor(carto);
        this.geoReady = true;
        console.log('GeoAnchor creado con éxito');
      }
    } catch (err) {
      console.warn('No se pudo obtener referenceSpace geospatial:', err);
      // Aunque no exista referenceSpace geospatial, intentamos crear el ancla igualmente
      if (window.XRGeospatialAnchor) {
        try {
          const carto = new Cesium.Cartographic(
            App.GEO_LON,
            App.GEO_LAT,
            App.GEO_ALT
          );
          this.geoAnchor = await XRGeospatialAnchor.createGeoAnchor(carto);
          this.geoReady = true;
          console.log('GeoAnchor creado (con referenceSpace local)');
        } catch(e) {
          console.warn('Falló la creación de XRGeospatialAnchor:', e);
        }
      }
    }

    // Si en 5 s no hay geoAnchor, activamos modo fallback
    setTimeout(() => {
      if (!this.geoReady) {
        console.warn('Activando modo fallback por falta de geoAnchor');
        this.fallbackMode = true;
      }
    }, 5000);

    // Cargar nuevo modelo 3D (Santa maría)
    const objLoader = new THREE.OBJLoader();
    objLoader.setPath('assets/');
    objLoader.load('barn.obj', (object) => {
      this.model = object;
      // Ajusta la escala si es necesario
      this.model.scale.set(3, 3, 3);
      this.model.traverse((c)=>{ c.castShadow = true; c.receiveShadow = true; });
      this.model.matrixAutoUpdate = false; // para geoAnchor; se habilitará en fallback cuando se coloque
      this.scene.add(this.model);
      console.log('Modelo Santa maría cargado');
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
        this.reticle.visible = !(this.geoReady);
        this.reticle.position.set(
          hitPose.transform.position.x,
          hitPose.transform.position.y,
          hitPose.transform.position.z
        );
        this.reticle.updateMatrixWorld(true);

        // Fallback: colocar modelo en primer hit-test
        if (this.fallbackMode && this.model && !this.modelPlaced) {
          this.model.position.copy(this.reticle.position);
          this.model.matrixAutoUpdate = true;
          this.modelPlaced = true;
          console.log('Modelo colocado mediante fallback en la primera superficie.');
        }
      }

      // Actualizar posición del modelo georreferenciado
      if (this.geoAnchor && this.model) {
        const geoPose = this.geoAnchor.getPose(this.anchorReferenceSpace);
        if (geoPose) {
          this.model.matrix.fromArray(geoPose.transform.matrix);
          this.model.updateMatrixWorld(true);
        }
      }

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
