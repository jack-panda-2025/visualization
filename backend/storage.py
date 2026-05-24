"""
Cloud storage abstraction — S3-compatible (AWS S3, Aliyun OSS, MinIO).
"""
from __future__ import annotations

import boto3
from botocore.client import Config
from botocore.exceptions import ClientError
from datetime import datetime
from typing import Optional

from config import settings


def _client():
    kwargs = dict(
        aws_access_key_id=settings.S3_ACCESS_KEY,
        aws_secret_access_key=settings.S3_SECRET_KEY,
        region_name=settings.S3_REGION,
        config=Config(signature_version="s3v4"),
    )
    if settings.S3_ENDPOINT_URL:
        kwargs["endpoint_url"] = settings.S3_ENDPOINT_URL
    return boto3.client("s3", **kwargs)


def list_simulations() -> list[dict]:
    """
    列出桶内所有 .bin 仿真文件，返回元数据列表。
    """
    client = _client()
    prefix = settings.S3_PREFIX
    paginator = client.get_paginator("list_objects_v2")

    results = []
    for page in paginator.paginate(Bucket=settings.S3_BUCKET, Prefix=prefix):
        for obj in page.get("Contents", []):
            key: str = obj["Key"]
            if not key.endswith(".bin"):
                continue
            name = key[len(prefix):]          # 去掉前缀，只留文件名
            sim_id = name.removesuffix(".bin")
            results.append({
                "id": sim_id,
                "name": sim_id.replace("_", " "),
                "key": key,
                "size": obj["Size"],
                "last_modified": obj["LastModified"].isoformat(),
            })

    results.sort(key=lambda x: x["last_modified"], reverse=True)
    return results


def get_signed_url(sim_id: str) -> Optional[str]:
    """
    生成指定仿真文件的临时签名下载 URL。
    """
    client = _client()
    key = settings.S3_PREFIX + sim_id + ".bin"

    # 验证文件存在
    try:
        client.head_object(Bucket=settings.S3_BUCKET, Key=key)
    except ClientError as e:
        if e.response["Error"]["Code"] in ("404", "NoSuchKey"):
            return None
        raise

    url = client.generate_presigned_url(
        "get_object",
        Params={"Bucket": settings.S3_BUCKET, "Key": key},
        ExpiresIn=settings.SIGNED_URL_EXPIRES,
    )
    return url
