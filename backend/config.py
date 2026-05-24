from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # S3-compatible storage (AWS S3 / Aliyun OSS / MinIO)
    S3_ENDPOINT_URL: str = ""          # 留空 = AWS S3；OSS 填 https://oss-cn-xxx.aliyuncs.com
    S3_ACCESS_KEY: str = ""
    S3_SECRET_KEY: str = ""
    S3_REGION: str = "us-east-1"
    S3_BUCKET: str = ""
    S3_PREFIX: str = ""                # 桶内子目录，如 "simulations/"

    SIGNED_URL_EXPIRES: int = 3600     # 签名 URL 有效期（秒）

    # CORS
    CORS_ORIGINS: list[str] = ["http://localhost:5173", "http://localhost:5174"]

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
