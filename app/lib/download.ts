/**
 * 화면 내보내기 도우미(DSH-06.01): 텍스트 파일 내려받기와 화면 영역 PNG.
 * PNG는 영역을 복제해 계산된 스타일을 붙이고, 차트 캔버스는 같은 픽셀의 이미지(`canvas.toDataURL`, ECharts `getDataURL`과 같은 결과)로
 * 바꾼 뒤 SVG foreignObject → 캔버스로 그린다. 외부 자원을 쓰지 않으므로 CSP(`img-src 'self' data: blob:`) 안에서 된다.
 */

export function downloadBlob(blob: Blob, fileName: string, doc: Document = document): void {
  const url = URL.createObjectURL(blob);
  const a = doc.createElement("a");
  a.href = url;
  a.download = fileName;
  a.rel = "noopener";
  doc.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadText(text: string, fileName: string, mime = "text/csv;charset=utf-8"): void {
  downloadBlob(new Blob([text], { type: mime }), fileName);
}

export function downloadDataUrl(dataUrl: string, fileName: string, doc: Document = document): void {
  const a = doc.createElement("a");
  a.href = dataUrl;
  a.download = fileName;
  doc.body.appendChild(a);
  a.click();
  a.remove();
}

export interface PngDeps {
  loadImage: (src: string) => Promise<CanvasImageSource>;
  createCanvas: (width: number, height: number) => HTMLCanvasElement;
}

const defaultDeps: PngDeps = {
  loadImage: (src) =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("image"));
      img.src = src;
    }),
  createCanvas: (width, height) => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  },
};

/** 계산된 스타일을 복제본에 인라인으로 붙인다(foreignObject 안에서는 문서 CSS가 없으므로) */
function inlineStyles(source: Element, target: Element) {
  const view = source.ownerDocument.defaultView;
  if (!view) return;
  const style = view.getComputedStyle(source);
  const parts: string[] = [];
  for (let i = 0; i < style.length; i += 1) {
    const name = style.item(i);
    parts.push(`${name}:${style.getPropertyValue(name)}`);
  }
  (target as HTMLElement).setAttribute("style", parts.join(";"));
  const sourceChildren = source.children;
  const targetChildren = target.children;
  for (let i = 0; i < sourceChildren.length && i < targetChildren.length; i += 1) inlineStyles(sourceChildren[i], targetChildren[i]);
}

/** 영역을 PNG data URL로. 화면 메뉴(.no-export)는 빼고 그린다 */
export async function nodeToPng(node: HTMLElement, background: string, scale = 2, deps: PngDeps = defaultDeps): Promise<string> {
  const width = Math.max(1, Math.ceil(node.getBoundingClientRect().width || node.scrollWidth || 800));
  const height = Math.max(1, Math.ceil(node.getBoundingClientRect().height || node.scrollHeight || 600));
  const clone = node.cloneNode(true) as HTMLElement;
  inlineStyles(node, clone);
  const sourceCanvases = node.querySelectorAll("canvas");
  clone.querySelectorAll("canvas").forEach((canvas, i) => {
    const img = node.ownerDocument.createElement("img");
    try {
      img.src = sourceCanvases[i].toDataURL("image/png");
    } catch {
      img.alt = "";
    }
    img.setAttribute("style", canvas.getAttribute("style") ?? "");
    canvas.replaceWith(img);
  });
  clone.querySelectorAll(".no-export").forEach((el) => el.remove());
  clone.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
  const xml = new XMLSerializer().serializeToString(clone);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject x="0" y="0" width="100%" height="100%">${xml}</foreignObject></svg>`;
  const image = await deps.loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
  const canvas = deps.createCanvas(width * scale, height * scale);
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(scale, scale);
    ctx.drawImage(image, 0, 0);
  }
  return canvas.toDataURL("image/png");
}
