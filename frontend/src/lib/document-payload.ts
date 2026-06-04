const DOCUMENT_CREATE_ONLY_FIELDS = [
  "project_id",
  "document_type",
  "reference_no",
] as const;

type DocumentCreateOnlyField = (typeof DOCUMENT_CREATE_ONLY_FIELDS)[number];

export function omitDocumentCreateOnlyFields<T extends Record<string, unknown>>(
  payload: T,
): Omit<T, Extract<keyof T, DocumentCreateOnlyField>> {
  const updatePayload: Partial<Record<keyof T, unknown>> = { ...payload };

  for (const key of DOCUMENT_CREATE_ONLY_FIELDS) {
    if (key in updatePayload) {
      delete updatePayload[key as keyof T];
    }
  }

  return updatePayload as Omit<T, Extract<keyof T, DocumentCreateOnlyField>>;
}
