import cv2
import numpy as np
from PIL import Image


class ImagePreprocessor:
    def __init__(self, max_dim: int = 2000):
        self.max_dim = max_dim

    def to_grayscale(self, image: Image.Image) -> Image.Image:
        if image.mode == "L":
            return image
        return image.convert("L")

    def apply_threshold(self, image: Image.Image, method: str = "otsu") -> Image.Image:
        img_array = self.image_to_numpy(image)

        if method == "otsu":
            _, thresholded = cv2.threshold(
                img_array, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU
            )
        elif method == "adaptive":
            thresholded = cv2.adaptiveThreshold(
                img_array, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 11, 2
            )
        else:
            raise ValueError(f"Unknown threshold method: {method}")

        return self.numpy_to_image(thresholded)

    def denoise(self, image: Image.Image) -> Image.Image:
        img_array = self.image_to_numpy(image)
        if len(img_array.shape) == 2:
            img_array = cv2.cvtColor(img_array, cv2.COLOR_GRAY2BGR)
        denoised = cv2.fastNlMeansDenoisingColored(img_array, None, 10, 10, 7, 21)
        if len(denoised.shape) == 3:
            denoised = cv2.cvtColor(denoised, cv2.COLOR_BGR2GRAY)
        return self.numpy_to_image(denoised)

    def resize_image(
        self, image: Image.Image, max_dim: int | None = None
    ) -> Image.Image:
        target = max_dim or self.max_dim
        if image.size[0] <= target and image.size[1] <= target:
            return image

        ratio = min(target / image.size[0], target / image.size[1])
        new_size = (int(image.size[0] * ratio), int(image.size[1] * ratio))
        return image.resize(new_size, Image.LANCZOS)

    def preprocess(
        self,
        image: Image.Image,
        threshold_method: str = "otsu",
        denoise: bool = True,
    ) -> Image.Image:
        if image.size[0] == 0 or image.size[1] == 0:
            return image.convert("L")

        resized = self.resize_image(image)
        gray = self.to_grayscale(resized)

        if denoise:
            gray = self.denoise(gray)

        thresholded = self.apply_threshold(gray, method=threshold_method)

        return thresholded

    @staticmethod
    def image_to_numpy(image: Image.Image) -> np.ndarray:
        return np.array(image)

    @staticmethod
    def numpy_to_image(array: np.ndarray) -> Image.Image:
        if array.dtype != np.uint8:
            array = array.astype(np.uint8)
        return Image.fromarray(array)
