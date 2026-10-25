from pydantic_settings import BaseSettings
from typing import List


class Settings(BaseSettings):
    SERVICE_NAME: str = "tracking-service"
    PORT: int = 3003
    HOST: str = "127.0.0.1"
    API_PREFIX: str = "/api/v1"
    
    # MongoDB
    MONGO_URI: str = "mongodb://localhost:27017"
    MONGO_DB: str = "logistics_tracking"
    
    # RabbitMQ
    RABBITMQ_ENABLED: bool = False
    RABBITMQ_URL: str = "amqp://guest:guest@localhost:5672/"
    RABBITMQ_EXCHANGE: str = "logistics.events"
    
    # CORS
    CORS_ORIGINS: List[str] = [
        "http://localhost:3000",
        "http://localhost:5173",
        "http://localhost:3001",
        "http://localhost:3002",
        "http://localhost:3003",
    ]

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
