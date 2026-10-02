use serde::{Serialize, Serializer};

/// Error type shared by the command modules. It always crosses the IPC boundary as a plain
/// string, so the `Display` text is the contract with the frontend.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    /// A relative document path failed validation (see `storage::resolve`).
    #[error("invalid path")]
    InvalidPath,
    /// Any other failure, already formatted for display.
    #[error("{0}")]
    Message(String),
}

impl AppError {
    pub fn message(message: impl Into<String>) -> Self {
        Self::Message(message.into())
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_as_plain_string() {
        assert_eq!(
            serde_json::to_string(&AppError::InvalidPath).unwrap(),
            "\"invalid path\""
        );
        assert_eq!(
            serde_json::to_string(&AppError::message("boom")).unwrap(),
            "\"boom\""
        );
    }
}
