"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api";
import { useSelectedProject } from "@/hooks/use-project";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Bell, X, Trash2 } from "lucide-react";

interface Notification {
  id: string;
  title: string;
  message: string;
  link: string | null;
  is_read: boolean;
  created_at: string;
}

function timeAgo(date: string): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  const intervals: [number, string][] = [
    [31536000, "year"],
    [2592000, "month"],
    [86400, "day"],
    [3600, "hour"],
    [60, "minute"],
  ];
  for (const [secs, label] of intervals) {
    const count = Math.floor(seconds / secs);
    if (count >= 1) return `${count} ${label}${count > 1 ? "s" : ""} ago`;
  }
  return "just now";
}

export default function NotificationsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const project = useSelectedProject();
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [removing, setRemoving] = useState<Set<string>>(new Set());
  const [clearingAll, setClearingAll] = useState(false);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["notifications"] });
    queryClient.invalidateQueries({
      queryKey: ["notifications", "unread-count"],
    });
  };

  const { data: notifications = [], isLoading } = useQuery<Notification[]>({
    queryKey: ["notifications", project?.id],
    queryFn: () =>
      api
        .get("/notifications", { params: { project_id: project?.id } })
        .then((r) => r.data),
    enabled: !!project?.id,
  });

  const markRead = useMutation({
    mutationFn: (id: string) => api.patch(`/notifications/${id}/read`),
    onSuccess: invalidate,
  });

  const markAllRead = useMutation({
    mutationFn: () => api.patch("/notifications/mark-all-read"),
    onSuccess: invalidate,
  });

  const deleteOne = useMutation({
    mutationFn: (id: string) => api.delete(`/notifications/${id}`),
    onSuccess: invalidate,
  });

  const clearAll = useMutation({
    mutationFn: () => api.delete("/notifications"),
    onSuccess: () => {
      invalidate();
      setConfirmClearAll(false);
      setClearingAll(false);
    },
  });

  const animateAndDelete = useCallback(
    (id: string) => {
      setRemoving((prev) => new Set(prev).add(id));
      setTimeout(() => {
        deleteOne.mutate(id);
        setRemoving((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }, 300);
    },
    [deleteOne],
  );

  const animateAndClearAll = useCallback(() => {
    setClearingAll(true);
    setTimeout(() => clearAll.mutate(), 400);
  }, [clearAll]);

  const handleClick = (n: Notification) => {
    if (!n.is_read) markRead.mutate(n.id);
    if (n.link) router.push(n.link);
  };

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        Loading...
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">Notifications</h1>
          {unreadCount > 0 && (
            <Badge variant="secondary">{unreadCount} unread</Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => markAllRead.mutate()}
              disabled={markAllRead.isPending}
            >
              Mark all as read
            </Button>
          )}
          {notifications.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmClearAll(true)}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="h-4 w-4 mr-1" />
              Clear all
            </Button>
          )}
        </div>
      </div>

      {notifications.length === 0 ? (
        <Card className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <Bell className="h-12 w-12 mb-4 opacity-40" />
          <p className="text-sm">No notifications yet</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {notifications.map((n, i) => (
            <div
              key={n.id}
              className="transition-all duration-300 ease-in-out"
              style={{
                opacity: removing.has(n.id) || clearingAll ? 0 : 1,
                transform: removing.has(n.id)
                  ? "translateX(40px)"
                  : clearingAll
                    ? "scale(0.95)"
                    : "translateX(0)",
                maxHeight: removing.has(n.id) ? "0px" : "200px",
                marginBottom: removing.has(n.id) ? "0px" : undefined,
                overflow: "hidden",
                transitionDelay: clearingAll ? `${i * 50}ms` : "0ms",
              }}
            >
              <Card
                className={`p-4 cursor-pointer transition-colors hover:bg-muted/50 group relative ${
                  !n.is_read ? "bg-primary/5 border-l-2 border-primary" : ""
                }`}
              >
                <div
                  className="flex items-start justify-between gap-4"
                  onClick={() => handleClick(n)}
                >
                  <div className="space-y-1 min-w-0">
                    <p
                      className={`text-sm ${!n.is_read ? "font-medium" : "text-muted-foreground"}`}
                    >
                      {n.title}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {n.message}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {timeAgo(n.created_at)}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        animateAndDelete(n.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                      title="Delete notification"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </Card>
            </div>
          ))}
        </div>
      )}

      <Dialog open={confirmClearAll} onOpenChange={setConfirmClearAll}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Clear All Notifications</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to clear all notifications? This action cannot
            be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmClearAll(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmClearAll(false);
                animateAndClearAll();
              }}
              disabled={clearAll.isPending}
            >
              Clear all
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
