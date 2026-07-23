// The spec's "Snackbar" is Spicetify's toast: Spicetify.showNotification.
export const notifications = {
  info(message: string): void {
    Spicetify.showNotification(message);
  },
  error(message: string): void {
    Spicetify.showNotification(message, true);
  },
};
