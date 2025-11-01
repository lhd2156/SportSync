from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/api/auth", tags=["auth"])

class LoginRequest(BaseModel):
    email: str
    password: str

@router.post("/login")
def login(request: LoginRequest):
    if request.email == "test@example.com" and request.password == "123456":
        return {"message": "Login successful", "token": "fake-jwt-token"}
    else:
        raise HTTPException(status_code=401, detail="Invalid credentials")
