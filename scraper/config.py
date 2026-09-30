from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    REDDIT_RSS_URL: str
    GCP_PROJECT_ID: str
    GCS_BUCKET_NAME: str

    model_config = SettingsConfigDict(
        env_file=[".env", "../.env"],
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore"
    )

settings = Settings()
