/**
 * Email template identifiers
 */
export enum Templates {
  feedbackForm = "feedback-form",
  mapChangeRequest = "map-change-request",
}

/**
 * Default subjects for each template
 */
export const DefaultSubject: { [key in Templates]?: string } = {
  [Templates.feedbackForm]: "Feedback Form",
  [Templates.mapChangeRequest]: "F3 Map Change Request",
};

/**
 * Feedback form template data
 */
export interface FeedbackFormData {
  type: string;
  email: string;
  subject: string;
  description: string;
}

/**
 * Map change request template data
 */
export interface MapChangeRequestData {
  regionName: string;
  workoutName: string;
  requestType: string;
  submittedBy: string;
  requestsUrl: string;
  noAdminsNotice?: boolean;
  recipientRole?: string;
  recipientOrg?: string;
}

/**
 * Template data types mapped by template
 */
export interface TemplateType {
  [Templates.feedbackForm]: FeedbackFormData;
  [Templates.mapChangeRequest]: MapChangeRequestData;
}
