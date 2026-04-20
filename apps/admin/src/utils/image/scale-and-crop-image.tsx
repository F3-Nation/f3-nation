/**
 * Given a File that represents an image and a new width and height,
 * return the newly scaled and cropped image, or null in the case of
 * an error
 * @param file
 * @param newWidth
 * @param newHeight
 */
export function scaleAndCropImage(
  file: File | Blob,
  newWidth: number,
  newHeight: number,
): Promise<Blob | null> {
  return new Promise((resolve, reject) => {
    const image = new Image();

    image.src = URL.createObjectURL(file);
    image.onload = () => {
      // if the image is smaller than the new dimensions, return
      if (image.width <= newWidth && image.height <= newHeight) {
        resolve(file);
      }

      // set up some variables to help scale the image
      const imageRatio = image.width / image.height;
      const newRatio = newWidth / newHeight;
      let scaledWidth, scaledHeight;
      let widthOffset = 0;
      let heightOffset = 0;

      // using the ratios of the original image w/h and the new
      // width and height, determine which dimension will be the
      // limiter, scale the other dimension appropriately, and
      // determine an offset that will center the image on the
      // dimension that exceeds the bounds
      if (imageRatio > newRatio) {
        scaledWidth = newHeight * imageRatio;
        scaledHeight = newHeight; // limiter
        widthOffset = (scaledWidth - newWidth) / 2;
      } else {
        scaledWidth = newWidth; // limiter
        scaledHeight = newWidth / imageRatio;
        heightOffset = (scaledHeight - newHeight) / 2;
      }

      // now that the image is scaled to fit the new dimensions
      // (on at least one dimension) create the canvas with the
      // new width and height so we can "crop" it
      const canvas = document.createElement("canvas");
      canvas.width = newWidth;
      canvas.height = newHeight;

      // draw the image with the offsets and then convert it to
      // blob so we can upload the raw data as a cropped image
      const context = canvas.getContext("2d");
      if (context !== null) {
        context.drawImage(
          image,
          -widthOffset,
          -heightOffset,
          scaledWidth,
          scaledHeight,
        );
        canvas.toBlob(resolve, file.type);
      } else {
        resolve(null);
      }
    };
    image.onerror = reject;
  });
}
