import cv2
import logging
import numpy as np
from dataclasses import dataclass, field
from PIL import Image
import time
import metrics


logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class QualityThresholds:
    """Configurable thresholds for image quality gates.

    Defaults are conservative to protect against poor field-upload conditions.
    Override via the IMAGE_QUALITY_* environment variables (see config.py).

    Attributes:
        min_width: Minimum image width in pixels.
        min_height: Minimum image height in pixels.
        min_mean_brightness: Minimum mean pixel brightness (0-255).
            Below this the image is considered near-black / under-exposed.
        max_mean_brightness: Maximum mean pixel brightness (0-255).
            Above this the image is considered near-white / over-exposed.
        min_laplacian_variance: Minimum Laplacian variance for blur detection.
            Lower values indicate a blurrier image.
    """

    min_width: int = 200
    min_height: int = 200
    min_mean_brightness: float = 20.0
    max_mean_brightness: float = 235.0
    min_laplacian_variance: float = 80.0


@dataclass
class QualityGateResult:
    """Result returned by ImageQualityGate.run()."""

    passed: bool
    rejections: list[str] = field(default_factory=list)


class ImageQualityGate:
    """Pre-inference quality gate that rejects unusable images before they
    are dispatched to a paid provider.

    Three checks are performed:
        1. **Resolution** – image dimensions must meet minimum width/height.
        2. **Exposure** – mean pixel brightness must fall within an acceptable
           range (not near-black and not near-white).
        3. **Blur** – the Laplacian variance must exceed a threshold (higher
           = sharper).

    All thresholds are configurable via ``QualityThresholds``.  Gate
    rejections are counted in the ``IMAGE_QUALITY_GATE_REJECTIONS_TOTAL``
    Prometheus counter, labelled by ``reason``.
    """

    def __init__(self, thresholds: QualityThresholds | None = None):
        self.thresholds = thresholds or QualityThresholds()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def run(self, image: Image.Image) -> QualityGateResult:
        """Evaluate all quality checks on *image*.

        Returns a ``QualityGateResult`` with ``passed=True`` when every
        check succeeds, or ``passed=False`` with a list of human-readable
        rejection reasons.
        """
        rejections: list[str] = []
        self._check_resolution(image, rejections)
        self._check_exposure(image, rejections)
        self._check_blur(image, rejections)

        if rejections:
            for reason in rejections:
                metrics.IMAGE_QUALITY_GATE_REJECTIONS_TOTAL.labels(
                    reason=reason
                ).inc()
            return QualityGateResult(passed=False, rejections=rejections)

        return QualityGateResult(passed=True)

    # ------------------------------------------------------------------
    # Individual checks
    # ------------------------------------------------------------------

    def _check_resolution(
        self, image: Image.Image, rejections: list[str]
    ) -> None:
        width, height = image.size
        if width < self.thresholds.min_width or height < self.thresholds.min_height:
            reason = (
                f"Image too small: {width}x{height}px, "
                f"minimum is {self.thresholds.min_width}x{self.thresholds.min_height}px"
            )
            logger.warning("Quality gate: %s", reason)
            rejections.append(reason)

    def _check_exposure(
        self, image: Image.Image, rejections: list[str]
    ) -> None:
        gray = image.convert("L")
        arr = np.array(gray)
        mean_brightness = float(arr.mean())

        if mean_brightness < self.thresholds.min_mean_brightness:
            reason = (
                f"Image too dark: mean brightness {mean_brightness:.1f}, "
                f"minimum is {self.thresholds.min_mean_brightness}"
            )
            logger.warning("Quality gate: %s", reason)
            rejections.append(reason)
        elif mean_brightness > self.thresholds.max_mean_brightness:
            reason = (
                f"Image too bright: mean brightness {mean_brightness:.1f}, "
                f"maximum is {self.thresholds.max_mean_brightness}"
            )
            logger.warning("Quality gate: %s", reason)
            rejections.append(reason)

    def _check_blur(
        self, image: Image.Image, rejections: list[str]
    ) -> None:
        gray = image.convert("L")
        arr = np.array(gray)
        laplacian_var = float(cv2.Laplacian(arr, cv2.CV_64F).var())

        if laplacian_var < self.thresholds.min_laplacian_variance:
            reason = (
                f"Image too blurry: Laplacian variance {laplacian_var:.1f}, "
                f"minimum is {self.thresholds.min_laplacian_variance}"
            )
            logger.warning("Quality gate: %s", reason)
            rejections.append(reason)



class ImagePreprocessor:
    def __init__(
        self,
        max_dim: int = 2000,
        quality_gate: ImageQualityGate | None = None,
    ):
        self.max_dim = max_dim
        self.quality_gate = quality_gate

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
        start_time = time.time()

        try:
            if image.size[0] == 0 or image.size[1] == 0:
                return image.convert("L")

            resized = self.resize_image(image)
            gray = self.to_grayscale(resized)

            if denoise:
                gray = self.denoise(gray)

            thresholded = self.apply_threshold(gray, method=threshold_method)

            return thresholded
        finally:
            latency = time.time() - start_time
            metrics.PIPELINE_STEP_LATENCY.labels(step_name="preprocess").observe(
                latency
            )

    @staticmethod
    def image_to_numpy(image: Image.Image) -> np.ndarray:
        return np.array(image)

    @staticmethod
    def numpy_to_image(array: np.ndarray) -> Image.Image:
        if array.dtype != np.uint8:
            array = array.astype(np.uint8)
        return Image.fromarray(array)
