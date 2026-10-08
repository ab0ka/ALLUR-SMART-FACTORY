# Модель и окружение

Детектор: YOLOX-S, COCO, готовый ONNX `object_detection_yolox_2022nov.onnx` из OpenCV Zoo. Используется только класс COCO 2 `car`. Без обучения и ручной разметки.

- Источник: https://github.com/opencv/opencv_zoo/tree/main/models/object_detection_yolox
- Модель: https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/object_detection_yolox/object_detection_yolox_2022nov.onnx
- SHA256: `c5c2d13e59ae883e6af3b45daea64af4833a4951c92d116ec270d9ddbe998063`
- Лицензия модели: Apache-2.0; полный текст в `YOLOX-LICENSE.txt`. Copyright (c) 2021–2022 Megvii Inc.
- Трекер: ByteTrack из supervision 0.25.1, MIT: https://github.com/roboflow/supervision/tree/0.25.1
- Python 3.13.9; opencv-python 4.13.0.92; NumPy 2.4.2; SciPy 1.17.0.
- Вычисления: CPU, OpenCV DNN, 4 потока. GPU GTX 1650 4 GiB обнаружен, но для этого компонента не используется. Установленный PyTorch CPU-only не требуется.
- Диск F: отсутствует. Модель и видео находятся в `vision/street-traffic/cache/`, исключённой из Git локальным `vision/street-traffic/.gitignore`. Свободно около 110 GiB на C: при проверке.

Модель видит готовые автомобили. Незавершённые кузова и заводские условия не проверены. Значение confidence — выход модели, не измеренная точность на этой записи. Временные trackId могут меняться после перекрытия и не являются идентичностью автомобиля или VIN.
