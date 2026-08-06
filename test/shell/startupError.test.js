// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderStartupError } from '../../src/shell/startupError.js';

describe('renderStartupError', () => {
  it('clears the container and shows the given message', () => {
    const container = document.createElement('div');
    container.appendChild(document.createElement('canvas'));

    renderStartupError(container, 'Physics engine failed to load. Reload to try again.');

    expect(container.querySelector('canvas')).toBeNull();
    expect(container.textContent).toContain('Physics engine failed to load. Reload to try again.');
  });
});
