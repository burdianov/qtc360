"""Notifications API."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.types import NOTIFICATION_LIMIT
from app.models.notification import Notification
from app.models.user import User

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("")
async def list_notifications(
    project_id: UUID | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Get current user's notifications, optionally filtered by project.

    The Notification model does not have an is_deleted column, so no
    is_deleted filter is applied (and adding one would be a silent no-op).
    """
    query = select(Notification).where(Notification.user_id == user.id)
    if project_id:
        query = query.where(Notification.project_id == project_id)
    result = await db.execute(
        query.order_by(Notification.created_at.desc()).limit(NOTIFICATION_LIMIT)
    )
    return [
        {
            "id": str(n.id),
            "title": n.title,
            "message": n.message,
            "link": n.link,
            "is_read": n.is_read,
            "created_at": n.created_at.isoformat() if n.created_at else None,
        }
        for n in result.scalars().all()
    ]


@router.patch("/{notification_id}/read")
async def mark_read(
    notification_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Mark a notification as read."""
    result = await db.execute(
        select(Notification).where(
            Notification.id == notification_id,
            Notification.user_id == user.id,
        )
    )
    notif = result.scalar_one_or_none()
    if not notif:
        raise HTTPException(status_code=404, detail="Notification not found")
    notif.is_read = True
    await db.commit()
    return {"status": "ok"}


@router.patch("/mark-all-read")
async def mark_all_read(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Mark all notifications as read."""
    await db.execute(
        update(Notification)
        .where(Notification.user_id == user.id, Notification.is_read == False)  # noqa: E712
        .values(is_read=True)
    )
    await db.commit()
    return {"status": "ok"}


@router.delete("/{notification_id}")
async def delete_notification(
    notification_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Hard-delete a single notification (the Notification model has no
    is_deleted column, so this is a row delete rather than a soft-delete)."""
    result = await db.execute(
        select(Notification).where(
            Notification.id == notification_id,
            Notification.user_id == user.id,
        )
    )
    notif = result.scalar_one_or_none()
    if not notif:
        raise HTTPException(status_code=404, detail="Notification not found")
    await db.delete(notif)
    await db.commit()
    return {"status": "ok"}


@router.delete("")
async def clear_all_notifications(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Hard-delete all notifications for the current user."""
    await db.execute(
        update(Notification).where(Notification.user_id == user.id).values(is_read=True)
    )
    # The above is intentionally a no-op except for marking all read; we
    # follow up with a hard-delete so users can actually clear their inbox.
    from sqlalchemy import delete as sa_delete

    await db.execute(sa_delete(Notification).where(Notification.user_id == user.id))
    await db.commit()
    return {"status": "ok"}


@router.get("/unread-count")
async def unread_count(
    project_id: UUID | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Get count of unread notifications."""
    query = (
        select(func.count())
        .select_from(Notification)
        .where(
            Notification.user_id == user.id,
            Notification.is_read == False,  # noqa: E712
        )
    )
    if project_id:
        query = query.where(Notification.project_id == project_id)
    result = await db.execute(query)
    return {"count": result.scalar() or 0}
