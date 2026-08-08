// The look of a gunshot: the muzzle flash, the impact spark, and the mark it
// leaves. All three were hard geometry -- a faceted icosahedron for the flash
// and the spark, an opaque square for the mark -- which is why a burst read
// as black boxes stuck on a wall rather than as gunfire. Real shot feedback
// is soft and round and fades at its edges, and none of that is expressible
// as an untextured convex solid.
//
// Generated as pixel data rather than shipped as images. Both shapes are
// radial functions, so producing them costs a few lines instead of an asset
// download, a CREDITS entry, and one more load path that can fail (R18).
// Written into a plain Uint8Array rather than drawn on a canvas so they stay
// pure JS: the shape is then unit-testable with no DOM, and this codebase has
// deliberately never introduced canvas 2D (minimap.js's KTD1 says so out
// loud). The render layer wraps these in a THREE.DataTexture.
//
// RGBA, one byte per channel, row-major from the top-left -- DataTexture's
// own expected layout.
export const CHANNELS = 4;

// Both generators work in a normalised disc: (0,0) at the texture's centre,
// radius 1 at the edge of the inscribed circle. Everything past that is fully
// transparent, so the quad's corners never show as a square edge -- which is
// the specific tell that made the old decal read as a box.
const TRANSPARENT = { luminance: 0, alpha: 0 };
const toByte = (value) => Math.round(Math.max(0, Math.min(1, value)) * 255);

function forEachTexel(size, write) {
  const data = new Uint8Array(size * size * CHANNELS);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const nx = ((x + 0.5) / size) * 2 - 1;
      const ny = ((y + 0.5) / size) * 2 - 1;
      const radius = Math.hypot(nx, ny);
      const { luminance, alpha } = radius > 1 ? TRANSPARENT : write(radius, Math.atan2(ny, nx));
      const grey = Math.round(Math.max(0, Math.min(255, luminance)));
      const i = (y * size + x) * CHANNELS;
      data[i] = grey;
      data[i + 1] = grey;
      data[i + 2] = grey;
      data[i + 3] = toByte(alpha);
    }
  }
  return data;
}

// A hot core fading to nothing: the muzzle flash and the impact spark are
// the same shape at different sizes and tints, so they share one texture and
// each caller supplies its own material colour. White here so a tint
// multiplies cleanly.
const GLOW_CORE_RADIUS = 0.35;

export function radialGlowTextureData(size) {
  return forEachTexel(size, (radius) => {
    // Quadratic falloff over the whole disc, plus a second quadratic bump
    // over the core, so the centre saturates and the edge vanishes smoothly
    // instead of ending on a visible ring.
    const outer = 1 - radius;
    const core = Math.max(0, 1 - radius / GLOW_CORE_RADIUS);
    return { luminance: 255, alpha: outer * outer + core * core };
  });
}

// A punched hole, a scorch ring around it, and a dust halo fading out.
const HOLE_RADIUS = 0.3;
const SCORCH_RADIUS = 0.5;
const HOLE_LUMINANCE = 10; // near black: the hole itself, not a dark paint splash
const SCORCH_LUMINANCE = 55;
const DUST_LUMINANCE = 80;

// Deterministic irregularity. A perfectly circular hole reads as a decal
// sticker; two out-of-phase harmonics make the rim ragged enough to look
// punched, without an RNG (which would make this untestable and make two
// marks on the same wall differ for no reason a player would credit).
//
// Both the order and the amplitude matter. A low harmonic at a large
// amplitude does not read as "ragged", it reads as a shape: 3 lobes at 16%
// gave every mark a clover outline, obvious the moment you walked up to a
// wall. High orders at a few percent perturb the rim without the eye ever
// resolving a pattern in it.
function rimWobble(angle) {
  return 1 + 0.05 * Math.sin(5 * angle + 0.7) + 0.035 * Math.sin(11 * angle + 2.1);
}

export function bulletHoleTextureData(size) {
  return forEachTexel(size, (radius, angle) => {
    const wobble = rimWobble(angle);
    const hole = HOLE_RADIUS * wobble;
    const scorch = SCORCH_RADIUS * wobble;
    if (radius <= hole) return { luminance: HOLE_LUMINANCE, alpha: 1 };
    if (radius <= scorch) {
      const t = (radius - hole) / (scorch - hole);
      return { luminance: HOLE_LUMINANCE + (SCORCH_LUMINANCE - HOLE_LUMINANCE) * t, alpha: 1 - 0.35 * t };
    }
    const t = (radius - scorch) / (1 - scorch);
    const fade = 1 - t;
    return { luminance: SCORCH_LUMINANCE + (DUST_LUMINANCE - SCORCH_LUMINANCE) * t, alpha: 0.45 * fade * fade };
  });
}
