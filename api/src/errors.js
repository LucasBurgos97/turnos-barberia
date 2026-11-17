export class ApiError extends Error {
  /**
   * @param {number} status
   * @param {string} code     estable, para que el frontend decida qué mostrar
   * @param {string} message  en español, mostrable al usuario
   */
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export const notFound = (code, message) => new ApiError(404, code, message);
export const badRequest = (code, message, extra) => new ApiError(400, code, message, extra);
export const conflict = (code, message) => new ApiError(409, code, message);
