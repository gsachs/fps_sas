// These are the shapes of the gunshot feedback -- flash, spark, bullet hole.
// Generating them as plain pixel data instead of drawing on a canvas is what
// makes them checkable here at all: the properties that decide whether a mark
// reads as a bullet hole or as a black box are all measurable off the array.
import { describe, expect, it } from 'vitest';
import { CHANNELS, bulletHoleTextureData, radialGlowTextureData } from '../../src/render/shotTextures.js';

const SIZE = 64;

function texel(data, size, x, y) {
  const i = (y * size + x) * CHANNELS;
  return { r: data[i], g: data[i + 1], b: data[i + 2], a: data[i + 3] };
}

const centre = (data, size) => texel(data, size, size / 2, size / 2);
const corner = (data, size) => texel(data, size, 0, 0);
const edgeMidpoint = (data, size) => texel(data, size, size / 2, 0);

describe('radial glow (muzzle flash and impact spark)', () => {
  const data = radialGlowTextureData(SIZE);

  it('fills an RGBA buffer of the requested size', () => {
    expect(data).toHaveLength(SIZE * SIZE * CHANNELS);
  });

  it('is opaque at the centre and fully transparent at the rim', () => {
    expect(centre(data, SIZE).a).toBe(255);
    expect(edgeMidpoint(data, SIZE).a).toBe(0);
  });

  it('leaves the corners transparent, so the quad never shows as a square', () => {
    // The specific tell that made the retired decal read as a box.
    expect(corner(data, SIZE).a).toBe(0);
  });

  it('falls off monotonically from centre to rim', () => {
    // A non-monotonic falloff shows as a visible ring rather than a glow.
    let previous = 256;
    for (let x = SIZE / 2; x < SIZE; x += 1) {
      const { a } = texel(data, SIZE, x, SIZE / 2);
      expect(a).toBeLessThanOrEqual(previous);
      previous = a;
    }
  });

  it('is white, so a caller can tint it to its own colour', () => {
    const { r, g, b } = centre(data, SIZE);
    expect([r, g, b]).toEqual([255, 255, 255]);
  });
});

describe('bullet hole', () => {
  const data = bulletHoleTextureData(SIZE);

  it('has a near-black opaque hole at its centre', () => {
    const { r, a } = centre(data, SIZE);
    expect(a).toBe(255);
    expect(r).toBeLessThan(30);
  });

  it('fades to nothing before the quad edge, and at the corners', () => {
    expect(edgeMidpoint(data, SIZE).a).toBe(0);
    expect(corner(data, SIZE).a).toBe(0);
  });

  it('lightens outward: hole darkest, then scorch, then dust', () => {
    const hole = centre(data, SIZE).r;
    const scorch = texel(data, SIZE, SIZE / 2 + 14, SIZE / 2).r;
    const dust = texel(data, SIZE, SIZE / 2 + 22, SIZE / 2).r;
    expect(hole).toBeLessThan(scorch);
    expect(scorch).toBeLessThan(dust);
  });

  it('has a ragged rim rather than a perfect circle', () => {
    // A perfectly circular hole reads as a sticker. The rim is perturbed by
    // two out-of-phase harmonics -- deliberately only a few percent, since a
    // strong low harmonic reads as a clover rather than as raggedness, so
    // this measures at a resolution where a few percent is more than a
    // rounding step.
    const fine = 256;
    const fineData = bulletHoleTextureData(fine);
    const opaqueRadiusAt = (angle) => {
      const [dx, dy] = [Math.cos(angle), Math.sin(angle)];
      for (let radius = 0; ; radius += 0.5) {
        const x = Math.round(fine / 2 + dx * radius);
        const y = Math.round(fine / 2 + dy * radius);
        if (x < 0 || y < 0 || x >= fine || y >= fine) return radius;
        if (texel(fineData, fine, x, y).a < 255) return radius;
      }
    };
    const radii = Array.from({ length: 12 }, (_, i) => opaqueRadiusAt((i / 12) * Math.PI * 2));
    expect(Math.max(...radii) - Math.min(...radii)).toBeGreaterThan(1);
    // ...but not so ragged that it stops reading as one round hole.
    expect(Math.max(...radii) / Math.min(...radii)).toBeLessThan(1.35);
  });

  it('is deterministic, so two marks on one wall are not gratuitously different', () => {
    expect(bulletHoleTextureData(SIZE)).toEqual(data);
  });
});
