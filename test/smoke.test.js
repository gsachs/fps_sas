import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createScene } from '../src/render/scene.js';

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

    const composerStub = {
      passes: [],
      addPass(pass) {
        this.passes.push(pass);
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
    return { createPostFX, composerStub, SSAOPassCtor };
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

  it('forwards a resize to the composer, and to SSAO at that same reduced resolution', async () => {
    const { createPostFX, composerStub, SSAOPassCtor } = await loadStubbedPostFX();

    const { setSize } = createPostFX({ renderer: {}, scene: {}, camera: {}, width: 800, height: 600 });
    const ssaoPass = SSAOPassCtor.mock.results[0].value;

    setSize(1600, 900);

    expect(composerStub.setSize).toHaveBeenCalledWith(1600, 900);
    expect(ssaoPass.setSize).toHaveBeenCalledWith(800, 450);
  });
});
