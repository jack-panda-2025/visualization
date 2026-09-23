from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # S3-compatible storage (AWS S3 / Aliyun OSS / MinIO)
    S3_ENDPOINT_URL: str = ""          # Leave blank for AWS S3; set for OSS/MinIO e.g. https://oss-cn-xxx.aliyuncs.com
    S3_ACCESS_KEY: str = ""
    S3_SECRET_KEY: str = ""
    S3_REGION: str = "us-east-1"
    S3_BUCKET: str = ""
    S3_PREFIX: str = ""                # Key prefix inside the bucket, e.g. "simulations/"

    SIGNED_URL_EXPIRES: int = 3600     # Pre-signed URL TTL in seconds

    # CORS
    CORS_ORIGINS: list[str] = ["http://localhost:5173", "http://localhost:5174"]

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
