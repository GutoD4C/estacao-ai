//! Operational dashboard view models.

use crate::operations::AgentCard;
use crate::templates::SessionRow;
use askama::Template;

#[derive(Template)]
#[template(path = "agent.html")]
pub(crate) struct AgentView {
    pub i18n: ai_memory_core::i18n::Localizer,
    pub workspace: String,
    pub project: String,
    pub project_href: String,
    pub card: AgentCard,
    pub sessions: Vec<SessionRow>,
    pub previous: String,
    pub next: String,
}
