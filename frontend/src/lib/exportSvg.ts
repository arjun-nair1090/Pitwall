// Saves an on-screen SVG as a PNG. The SVG must carry its colours as attributes (not CSS classes),
// because a serialised copy no longer has the page's stylesheet.
export function exportSvgAsPng(svg: SVGSVGElement, filename: string, options: { size?: number; background?: string } = {}): Promise<void> {
  const { size = 1000, background = "#13161B" } = options;
  const markup = new XMLSerializer().serializeToString(svg);
  const url = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml;charset=utf-8" }));

  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error("This browser can't draw the image."));
        return;
      }
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, size, size);
      ctx.drawImage(image, 0, 0, size, size);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("Couldn't create the image."));
          return;
        }
        const download = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = download;
        link.download = filename;
        link.click();
        URL.revokeObjectURL(download);
        resolve();
      }, "image/png");
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Couldn't render the map as an image."));
    };
    image.src = url;
  });
}
