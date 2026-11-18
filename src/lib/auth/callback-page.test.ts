import { describe, expect, it } from 'vitest';
import { callbackPage, escapeHtml } from './callback-page.js';

describe('callbackPage', () => {
  it('renders the success state with the terminal hint', () => {
    const html = callbackPage(true, 'You can return to the terminal.');
    expect(html).toContain('<title>Signed in - agentage</title>');
    expect(html).toContain('class="card ok"');
    expect(html).toContain('You can return to the terminal.');
    expect(html).toContain('You can close this tab.');
  });

  it('renders the failure state with a retry hint', () => {
    const html = callbackPage(false, 'access_denied');
    expect(html).toContain('<title>Sign-in failed - agentage</title>');
    expect(html).toContain('class="card err"');
    expect(html).toContain('agentage setup again');
  });

  it('escapes the detail so a crafted redirect cannot inject markup', () => {
    const html = callbackPage(false, '<img src=x onerror="alert(1)">&');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;');
  });

  it('escapeHtml covers the four markup characters', () => {
    expect(escapeHtml('a<b>&"c"')).toBe('a&lt;b&gt;&amp;&quot;c&quot;');
  });

  it('a plain sign-in has no deep link', () => {
    const html = callbackPage(true, 'You can return to the terminal.');
    expect(html).not.toContain('agentage://');
    expect(html).not.toContain('http-equiv="refresh"');
  });

  it('a desktop sign-in hands over to the deep link and keeps the fallback text', () => {
    const html = callbackPage(true, 'You can return to the agentage app.', 'agentage://signed-in');
    expect(html).toContain('<meta http-equiv="refresh" content="0;url=agentage://signed-in">');
    expect(html).toContain('<a class="open" href="agentage://signed-in">Open the agentage app</a>');
    expect(html).toContain('You can close this tab.');
  });

  it('a failure never hands over, even with a return link', () => {
    const html = callbackPage(false, 'access_denied', 'agentage://signed-in');
    expect(html).not.toContain('agentage://');
  });

  it('escapes the link it is given', () => {
    const html = callbackPage(true, 'ok', 'agentage://x"><script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('agentage://x&quot;&gt;&lt;script&gt;');
  });
});
