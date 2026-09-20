from pydantic import BaseModel


class BlobUploadVO(BaseModel):
    original_filename: str
    blob_name: str
    container_name: str
    size: int
    content_type: str
    etag: str
