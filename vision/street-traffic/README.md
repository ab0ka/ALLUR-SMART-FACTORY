# Видеоаналитика записанного видео

Один рабочий сценарий: YOLOX-S распознаёт **car**, ByteTrack выдаёт временные ID, нижняя центральная точка рамки определяет принадлежность одной зоне. Результат — `analysis.json` согласованной схемы и необязательное видео с рамками. Существующее приложение, сервер и package.json не изменяются.

Демонстрационный источник — реальная дорожная запись San Francisco, **не Allur и не производственный цех**. Подробнее: [SOURCE.md](SOURCE.md), [MODEL.md](MODEL.md), [HANDOFF.md](HANDOFF.md).

## Точные команды PowerShell

Из корня проекта, Python 3.13:

```powershell
Set-Location 'C:\Users\ASUS\.codex\worktrees\vision-street-traffic\ALLUR-SMART-FACTORY'
py -3.13 -m venv vision\street-traffic\.venv
.\vision\street-traffic\.venv\Scripts\python.exe -m pip install -r vision\street-traffic\requirements.txt
powershell.exe -NoProfile -File vision\street-traffic\download-assets.ps1 -CacheDir "$PWD\vision\street-traffic\cache"
.\vision\street-traffic\.venv\Scripts\python.exe vision\street-traffic\probe.py --video vision\street-traffic\cache\street-traffic.webm --model vision\street-traffic\cache\object_detection_yolox_2022nov.onnx
.\vision\street-traffic\.venv\Scripts\python.exe vision\street-traffic\analyze.py --video vision\street-traffic\cache\street-traffic.webm --model vision\street-traffic\cache\object_detection_yolox_2022nov.onnx --config vision\street-traffic\config.json --output vision\street-traffic\analysis-new.json --annotated vision\street-traffic\cache\annotated-new.mp4
.\vision\street-traffic\.venv\Scripts\python.exe vision\street-traffic\validate.py vision\street-traffic\analysis-new.json
.\vision\street-traffic\.venv\Scripts\python.exe -m unittest discover -s vision\street-traffic\tests -v
```

На проверенном компьютере библиотеки уже установлены в Python 3.13.9; вместо `.\vision\street-traffic\.venv\Scripts\python.exe` можно использовать `python`. Не требуется активация среды или изменение ExecutionPolicy. Если запуск .ps1 запрещён локальной политикой, скачайте два файла по ссылкам из MODEL.md/SOURCE.md в `vision/street-traffic/cache/` — анализатор не загружает их сам.

`download-assets.ps1` без `-CacheDir` предпочитает `F:\AllurVisionCache`, если F: существует. На этом компьютере F: отсутствует. Скрипт сохраняет существующие файлы, проверяет SHA256 модели. Модель и видео исключены из Git. `.env` не читается; ключи не нужны, кадры в облако не отправляются.

Для своего видео передайте `--video 'D:\path\recording.mp4'`, создайте копию `config.json`, исправьте сведения об источнике/лицензии, polygon и thresholdSec. Все точки в 0..1; bbox в экспорте = `[x,y,width,height]`. Видео должно содержать монотонные исходные временные метки. Смена камеры, монтаж и движущаяся камера требуют отдельного анализа; этот MVP их автоматически не обнаруживает.

## Время и посещения

- Время берётся из PTS декодера (`CAP_PROP_POS_MSEC`), не из скорости воспроизведения и не из времени вычислений. Для исходного WebM metadata FPS=1000 не является реальным fps.
- `sampleFps=5`: анализ примерно раз в 0.2 s. Выходное видео с рамками пишется на этой частоте; канонические отметки синхронизации находятся в `frames[].t`.
- Вход: точка глубже 0.01 от границы в течение 0.4 s. Выход: точка дальше 0.01 за границей в течение 0.4 s. Времена относятся к началу подтверждённой последовательности.
- `observedSec` — сумма интервалов между соседними фактически наблюдаемыми кадрами внутри зоны. Пропуски и интервалы снаружи не добавляются; это консервативное наблюдаемое время, а не гарантированное полное время пребывания.
- Потеря более 1 s: `lost`, `endSec=null`. У конца записи: `open_at_end`, `endSec=null`, если трек ещё не потерян. Потеря никогда не превращается в подтверждённый выход.
- `zoneId` отражает подтверждённое состояние с гистерезисом; во время подтверждения выхода он ещё может быть указан. Для незавершённых посещений нельзя подставлять конец ролика вместо endSec.
- Порог 5 s, `thresholdSource=demo_assumption`. Только **возможная задержка**. Причины, VIN, экономия, вероятность поломки и точность не оцениваются.
- Временный ID не гарантирует уникальность физического автомобиля; перекрытия и пропуски могут разделить его на несколько треков. Не считать количество trackId проверенным числом автомобилей.

## Результаты и повторный запуск

Основной результат: `analysis.json`. Ранняя передача: `analysis-early.json` — первые 10 s; `source.durationSec` описывает весь исходник, `analysis.analyzedUntilSec` — границу анализа. `analysis.mode` всегда `model`; ручного/синтетического fallback нет.

Команда не перезаписывает существующий JSON/видео без `--overwrite`. Для повторного прогона используйте новые имена, как в примере. При неверных временных метках или слишком редких кадрах анализ завершается ошибкой: понизьте sampleFps либо подготовьте корректное видео. Любое неполное видео после ошибки не считать готовым результатом.

OpenCV сохраняет аннотированный MP4 кодеком mp4v; он предназначен для локального проигрывателя и может не воспроизводиться в браузере. Для интерфейса используйте исходный VP8 WebM и JSON-рамки по `video.currentTime`. Встроенного веб-сервера в компоненте нет.
