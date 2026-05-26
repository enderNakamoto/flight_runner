// Tiny "← arcade" link in the bottom-left of the game page so the
// player can bail back to the landing without rebooting the browser.
// Always visible during play; semi-transparent so it doesn't compete
// with anything on the canvas.

const STYLE = `
  #fs-back-link {
    position: fixed;
    left: 16px;
    bottom: 16px;
    z-index: 85;
    color: rgba(255, 255, 255, 0.7);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, monospace;
    font-size: 12px;
    text-decoration: none;
    background: rgba(0, 0, 0, 0.4);
    padding: 6px 10px;
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 4px;
    transition: background 0.1s, color 0.1s;
  }
  #fs-back-link:hover {
    background: rgba(0, 0, 0, 0.7);
    color: #fff;
  }
`;

export function mountBackLink(): void {
  if (document.getElementById("fs-back-link-style")) return;
  const s = document.createElement("style");
  s.id = "fs-back-link-style";
  s.textContent = STYLE;
  document.head.appendChild(s);

  const a = document.createElement("a");
  a.id = "fs-back-link";
  a.href = "/";
  a.textContent = "← arcade";
  document.body.appendChild(a);
}
