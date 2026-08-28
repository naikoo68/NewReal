// Read an image File, downscale it to fit within `max`x`max` pixels, and return
// a compact JPEG data-URI. Keeps profile pictures small so they store cleanly
// in the database and load fast. Falls back to the raw data-URI if anything
// unexpected happens.
export function fileToResizedDataUrl(file, max = 256, quality = 0.85) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type?.startsWith("image/")) {
      return reject(new Error("Please choose an image file."));
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Couldn't read that file."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("That image couldn't be loaded."));
      img.onload = () => {
        try {
          let { width, height } = img;
          if (width > max || height > max) {
            const scale = Math.min(max / width, max / height);
            width = Math.round(width * scale);
            height = Math.round(height * scale);
          }
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL("image/jpeg", quality));
        } catch {
          resolve(reader.result); // fall back to the original data-URI
        }
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
