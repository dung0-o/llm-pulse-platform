from enum import StrEnum

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class InferenceBackend(StrEnum):
    HUGGINGFACE = "huggingface"
    LOCAL = "local"

class Settings(BaseSettings):
    GCP_PROJECT_ID: str
    BQ_DATASET_NAME: str

    SENTIMENT_MODEL_ID: str
    INFERENCE_BACKEND: InferenceBackend
    HUGGINGFACE_API_KEY: SecretStr

    REDIS_URL: SecretStr
    REDIS_TOKEN: SecretStr

    model_config = SettingsConfigDict(
        env_file=[".env", "../.env"],
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore"
    )

settings = Settings()
