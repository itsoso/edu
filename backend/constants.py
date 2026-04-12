"""应用级常量. 与具体 Flask 实例无关, 无副作用, 可被任何 blueprint 导入."""
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
CONTENT_DIR = BASE_DIR / "content"
BACKEND_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = BACKEND_DIR / "data" / "uploads"

MAX_UPLOAD_BYTES = 8 * 1024 * 1024  # 8 MB
ALLOWED_IMAGE_EXT = {"jpg", "jpeg", "png", "webp"}

SUBJECTS = ["科学", "英语", "数学", "语文", "社会"]
FULL_MARKS = {"科学": 150, "英语": 120, "数学": 120, "语文": 120, "社会": 100}

# Journal 多媒体 (音频/视频)
JOURNAL_UPLOAD_DIR = BACKEND_DIR / "data" / "uploads" / "journal"
ALLOWED_MEDIA_EXT = {"webm", "mp4", "m4a", "ogg", "wav"}
MAX_MEDIA_UPLOAD_BYTES = 20 * 1024 * 1024  # 20 MB (视频)
MAX_AUDIO_DURATION_SECS = 180   # 3 分钟
MAX_VIDEO_DURATION_SECS = 120   # 2 分钟

# 确保运行时目录存在 (import 时就建, 避免每个 blueprint 都判)
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
JOURNAL_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
