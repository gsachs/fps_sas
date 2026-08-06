import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createScene, loadSkyBackground, SKY_COLOR } from '../src/render/scene.js';

describe('createScene', () => {
  it('builds a scene with a camera and lighting', () => {
    const { scene, camera } = createScene();

    expect(scene).toBeInstanceOf(THREE.Scene);
    expect(camera).toBeInstanceOf(THREE.PerspectiveCamera);

    const lights = scene.children.filter((child) => child.isLight);
    expect(lights.length).toBeGreaterThanOrEqual(2);
  });

  it('lights ambient from the sky rather than a single flat term', () => {
    const { scene } = createScene();

    const hemisphere = scene.children.find((child) => child.isHemisphereLight);
    expect(hemisphere).toBeDefined();
    // A flat AmbientLight would leave every face of a box identically lit,
    // which is most of why untextured geometry reads as unfinished (R14).
    expect(scene.children.some((child) => child.isAmbientLight)).toBe(false);
  });

  it('casts shadows from a sun whose shadow camera covers the arena', () => {
    const { scene } = createScene();

    const sun = scene.children.find((child) => child.isDirectionalLight);
    expect(sun).toBeDefined();
    expect(sun.castShadow).toBe(true);
    // The rooms-and-corridors floor is 34 units half-size (layout.js);
    // geometry outside the shadow camera's box stops casting with no error,
    // so this guards the extent (R12).
    expect(sun.shadow.camera.right).toBeGreaterThanOrEqual(34);
    expect(sun.shadow.camera.top).toBeGreaterThanOrEqual(34);
    expect(sun.shadow.camera.far).toBeGreaterThan(sun.position.length());
  });

  it('keeps fog clear of hunt-and-ambush engagement range so bots stay readable', () => {
    const { scene } = createScene();

    // R10: engagements in the new map tend to start at closer range than
    // the old open arena's. Fog closing in before that would hide targets
    // at exactly the range they matter most (R15); the precise distance is
    // a U6 live-play retuning surface, not fixed here.
    expect(scene.fog.near).toBeGreaterThanOrEqual(15);
  });

  // U5/KTD5/AE4: scene.background ignores scene.fog by design (that's why a
  // flat placeholder colour was ever seamless) -- so the only way the real
  // sky texture's horizon blends into fog without a visible band is if
  // fog's colour and the synchronous/failure-fallback background colour are
  // the exact same resampled constant. A hand-edited fog colour that drifts
  // from SKY_COLOR is exactly the regression this guards.
  it('gives scene.fog the same colour as the sky background (no horizon seam, R7/KTD5)', () => {
    const { scene } = createScene();

    expect(scene.fog.color.getHex()).toBe(SKY_COLOR);
    expect(scene.background).toBeInstanceOf(THREE.Color);
    expect(scene.background.getHex()).toBe(SKY_COLOR);
  });
});

describe('loadSkyBackground (U5/KTD5: real sky texture, placeholder-on-failure)', () => {
  it('swaps scene.background to the loaded texture, configured as an equirectangular background', async () => {
    vi.resetModules();

    const fakeTexture = new THREE.Texture();
    const load = vi.fn((_url, onLoad) => onLoad(fakeTexture));
    vi.doMock('three', async (importOriginal) => {
      const actual = await importOriginal();
      return { ...actual, TextureLoader: vi.fn().mockImplementation(() => ({ load })) };
    });

    const { createScene: createScopedScene, loadSkyBackground: loadScopedSky } = await import(
      '../src/render/scene.js'
    );
    const { scene } = createScopedScene();

    const result = await loadScopedSky(scene, 'sky.jpg');

    expect(result).toEqual({ loaded: true });
    expect(scene.background).toBe(fakeTexture);
    expect(fakeTexture.mapping).toBe(THREE.EquirectangularReflectionMapping);
    expect(fakeTexture.colorSpace).toBe(THREE.SRGBColorSpace);

    vi.doUnmock('three');
    vi.resetModules();
  });

  // No document global in this suite's Node environment, so three's real
  // TextureLoader (whose ImageLoader unconditionally calls
  // document.createElementNS) fails synchronously the moment .load() runs --
  // a real, deterministic failure with no mocking needed, the same technique
  // test/render/textures.test.js uses for loadSurfaceTexture's failure path.
  it('leaves scene.background on the flat SKY_COLOR fallback and reports the failure, never throwing', async () => {
    const { scene } = createScene();
    const onError = vi.fn();

    const result = await loadSkyBackground(scene, 'this-sky-path-does-not-resolve.jpg', { onError });

    expect(result).toEqual({ loaded: false });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(scene.background).toBeInstanceOf(THREE.Color);
    expect(scene.background.getHex()).toBe(SKY_COLOR);
  });
});

// createPostFX can't run against a real WebGLRenderer in the Node test
// suite (SSAOPass/SMAAPass touch WebGL and DOM APIs at construction time),
// so these assert the one thing that *is* pure here: which passes get added
// to the composer, in what order, with what the composer/SSAOPass resize
// forwarding does -- via the same doMock-the-addon-module technique
// test/render/models.test.js uses for GLTFLoader. Actual visual output
// (bloom/AO subtlety, ACES parity, fps) is owner-verified in a browser --
// see U1's report (KTD1, R8, R9).
describe('createPostFX (KTD1 chain order, stubbed -- no WebGL context)', () => {
  function makePassStub(kind) {
    return { kind, setSize: vi.fn() };
  }

  async function loadStubbedPostFX() {
    vi.resetModules();

    // addPass replicates the real EffectComposer's own side effect (it
    // unconditionally calls pass.setSize() at the composer's full
    // resolution on every pass added) -- without this the stub can't catch
    // a regression where that side effect clobbers a pass's own
    // reduced-resolution construction right after it's added.
    const composerStub = {
      passes: [],
      _width: 800,
      _height: 600,
      addPass(pass) {
        this.passes.push(pass);
        pass.setSize(this._width, this._height);
      },
      insertPass(pass, index) {
        this.passes.splice(index, 0, pass);
      },
      setSize: vi.fn(),
    };
    const EffectComposerCtor = vi.fn().mockImplementation(() => composerStub);
    const RenderPassCtor = vi.fn().mockImplementation(() => makePassStub('RenderPass'));
    const SSAOPassCtor = vi.fn().mockImplementation(() => makePassStub('SSAOPass'));
    const UnrealBloomPassCtor = vi.fn().mockImplementation(() => makePassStub('UnrealBloomPass'));
    const SMAAPassCtor = vi.fn().mockImplementation(() => makePassStub('SMAAPass'));
    const OutputPassCtor = vi.fn().mockImplementation(() => makePassStub('OutputPass'));

    vi.doMock('three/addons/postprocessing/EffectComposer.js', () => ({ EffectComposer: EffectComposerCtor }));
    vi.doMock('three/addons/postprocessing/RenderPass.js', () => ({ RenderPass: RenderPassCtor }));
    vi.doMock('three/addons/postprocessing/SSAOPass.js', () => ({ SSAOPass: SSAOPassCtor }));
    vi.doMock('three/addons/postprocessing/UnrealBloomPass.js', () => ({ UnrealBloomPass: UnrealBloomPassCtor }));
    vi.doMock('three/addons/postprocessing/SMAAPass.js', () => ({ SMAAPass: SMAAPassCtor }));
    vi.doMock('three/addons/postprocessing/OutputPass.js', () => ({ OutputPass: OutputPassCtor }));

    const { createPostFX } = await import('../src/render/postfx.js');
    return { createPostFX, composerStub, SSAOPassCtor, RenderPassCtor };
  }

  afterEach(() => {
    vi.doUnmock('three/addons/postprocessing/EffectComposer.js');
    vi.doUnmock('three/addons/postprocessing/RenderPass.js');
    vi.doUnmock('three/addons/postprocessing/SSAOPass.js');
    vi.doUnmock('three/addons/postprocessing/UnrealBloomPass.js');
    vi.doUnmock('three/addons/postprocessing/SMAAPass.js');
    vi.doUnmock('three/addons/postprocessing/OutputPass.js');
    vi.resetModules();
  });

  it('assembles world render -> SSAO -> bloom -> AA -> OutputPass, with OutputPass terminating the chain', async () => {
    const { createPostFX, composerStub } = await loadStubbedPostFX();

    createPostFX({ renderer: {}, scene: {}, camera: {}, width: 800, height: 600 });

    expect(composerStub.passes.map((pass) => pass.kind)).toEqual([
      'RenderPass',
      'SSAOPass',
      'UnrealBloomPass',
      'SMAAPass',
      'OutputPass',
    ]);
  });

  it('constructs SSAO at a reduced-resolution target, not the full frame (KTD1)', async () => {
    const { createPostFX, SSAOPassCtor } = await loadStubbedPostFX();

    createPostFX({ renderer: {}, scene: {}, camera: {}, width: 800, height: 600 });

    expect(SSAOPassCtor).toHaveBeenCalledWith(expect.anything(), expect.anything(), 400, 300);
  });

  // A code-review regression: EffectComposer.addPass() unconditionally
  // calls pass.setSize() at the composer's own full resolution on every
  // pass it's given -- so SSAOPass's own half-res construction was silently
  // overwritten back to full-res (800x600, not 400x300) the instant
  // composer.addPass(ssaoPass) ran, and stayed there for the rest of the
  // session unless the window happened to resize.
  it('keeps SSAO at its reduced resolution even after the composer clobbers it on addPass', async () => {
    const { createPostFX, SSAOPassCtor } = await loadStubbedPostFX();

    createPostFX({ renderer: {}, scene: {}, camera: {}, width: 800, height: 600 });

    const ssaoPass = SSAOPassCtor.mock.results[0].value;
    // The stub's addPass already ran setSize(800, 600) on ssaoPass by this
    // point (the clobber); the pass must end up back at the reduced size.
    expect(ssaoPass.setSize).toHaveBeenLastCalledWith(400, 300);
  });

  it('forwards a resize to the composer, and to SSAO at that same reduced resolution', async () => {
    const { createPostFX, composerStub, SSAOPassCtor } = await loadStubbedPostFX();

    const { setSize } = createPostFX({ renderer: {}, scene: {}, camera: {}, width: 800, height: 600 });
    const ssaoPass = SSAOPassCtor.mock.results[0].value;

    setSize(1600, 900);

    expect(composerStub.setSize).toHaveBeenCalledWith(1600, 900);
    expect(ssaoPass.setSize).toHaveBeenCalledWith(800, 450);
  });

  // KTD4/U2: addWeaponPass is the seam main.js uses to register the
  // viewmodel's depth-clear pass once a weapon camera exists (see U2's
  // report -- postfx.js reserves the slot at construction, before
  // weaponView.js has built a camera to give it). Untested until now.
  it('addWeaponPass inserts a depth-clear RenderPass at the reserved slot, between SSAO and bloom', async () => {
    const { createPostFX, composerStub, RenderPassCtor } = await loadStubbedPostFX();
    const { addWeaponPass } = createPostFX({ renderer: {}, scene: {}, camera: {}, width: 800, height: 600 });

    const fakeWeaponCamera = { isWeaponCamera: true };
    addWeaponPass(fakeWeaponCamera);

    // RenderPassCtor's first call built the world-render pass inside
    // createPostFX itself; this call is addWeaponPass's own.
    expect(RenderPassCtor).toHaveBeenCalledTimes(2);
    expect(RenderPassCtor).toHaveBeenLastCalledWith(expect.anything(), fakeWeaponCamera);

    const weaponPass = RenderPassCtor.mock.results[1].value;
    expect(composerStub.passes.map((pass) => pass.kind)).toEqual([
      'RenderPass', // world
      'SSAOPass',
      'RenderPass', // weapon depth-clear, inserted here -- after AO, before bloom (KTD4)
      'UnrealBloomPass',
      'SMAAPass',
      'OutputPass',
    ]);
    // clear: false keeps the AO-composited world color already in the
    // buffer; clearDepth: true resets only depth, so the weapon geometry
    // always wins the depth test against nearby world geometry.
    expect(weaponPass.clear).toBe(false);
    expect(weaponPass.clearDepth).toBe(true);
  });
});
