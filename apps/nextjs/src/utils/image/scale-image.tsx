/**
 * Given a File that represents an image and a new width and height,
 * scale the image to fit within these dimensions while maintaining aspect ratio
 * @param file
 * @param maxWidth
 * @param maxHeight
 */
export function scaleImage(
  file: File | Blob,
  maxWidth: number,
  maxHeight: number,
): Promise<Blob | null> {
  return new Promise((resolve, reject) => {
    const image = new Image();

    image.src = URL.createObjectURL(file);
    image.onload = () => {
      // if the image is smaller than the max dimensions, return original
      if (image.width <= maxWidth && image.height <= maxHeight) {
        resolve(file);
        return;
      }

      // Calculate new dimensions while maintaining aspect ratio
      const imageRatio = image.width / image.height;
      let newWidth = maxWidth;
      let newHeight = maxHeight;

      if (imageRatio > maxWidth / maxHeight) {
        // Width is the limiting factor
        newHeight = maxWidth / imageRatio;
      } else {
        // Height is the limiting factor
        newWidth = maxHeight * imageRatio;
      }

      // Create canvas with the new dimensions
      const canvas = document.createElement("canvas");
      canvas.width = newWidth;
      canvas.height = newHeight;

      // Draw the scaled image
      const context = canvas.getContext("2d");
      if (context !== null) {
        context.drawImage(image, 0, 0, newWidth, newHeight);
        canvas.toBlob(resolve, file.type);
      } else {
        resolve(null);
      }
    };
    image.onerror = reject;
  });
}
