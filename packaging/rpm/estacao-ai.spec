Name:           estacao-ai
# The release workflow replaces this placeholder from Cargo.toml.
Version:        0.3.2
Release:        1
Summary:        Local-first long-term memory MCP server for AI coding agents
License:        MIT
URL:            https://aimemory.sh
Source0:        https://github.com/akitaonrails/ai-memory/releases/download/v%{version}/estacao-ai-linux-%{_arch}.tar.gz
BuildArch:      %{_arch}
%global debug_package %{nil}
Requires:       systemd
Requires:       ca-certificates
Requires:       glibc
%global _unitdir /usr/lib/systemd/system
%global _userunitdir /usr/lib/systemd/user

%description
Cross-session memory for AI coding agents, with a local MCP server and
systemd service.

%prep
%setup -q -c

%install
install -Dpm0755 estacao-ai %{buildroot}%{_bindir}/estacao-ai
install -Dpm0644 README.md %{buildroot}%{_datadir}/doc/estacao-ai/README.md
install -Dpm0644 docs/install.md %{buildroot}%{_datadir}/doc/estacao-ai/install.md
install -Dpm0644 LICENSE %{buildroot}%{_licensedir}/estacao-ai/LICENSE
cp -a hooks %{buildroot}%{_datadir}/estacao-ai/
install -Dpm0644 packaging/systemd/estacao-ai.service %{buildroot}%{_unitdir}/estacao-ai.service
install -Dpm0644 packaging/systemd/estacao-ai-user.service %{buildroot}%{_userunitdir}/estacao-ai.service
install -Dpm0644 packaging/sysusers/estacao-ai.conf %{buildroot}%{_prefix}/lib/sysusers.d/estacao-ai.conf
install -Dpm0644 packaging/tmpfiles/estacao-ai.conf %{buildroot}%{_prefix}/lib/tmpfiles.d/estacao-ai.conf
install -Dpm0644 crates/ai-memory-cli/templates/config.default.toml %{buildroot}%{_sysconfdir}/estacao-ai/config.toml
install -Dpm0640 packaging/env/estacao-ai.env %{buildroot}%{_sysconfdir}/estacao-ai/env

%files
%config(noreplace) %{_sysconfdir}/estacao-ai/config.toml
%config(noreplace) %{_sysconfdir}/estacao-ai/env
%{_bindir}/estacao-ai
%{_datadir}/estacao-ai/
%{_datadir}/doc/estacao-ai/
%{_licensedir}/estacao-ai/LICENSE
%{_unitdir}/estacao-ai.service
%{_userunitdir}/estacao-ai.service
%{_prefix}/lib/sysusers.d/estacao-ai.conf
%{_prefix}/lib/tmpfiles.d/estacao-ai.conf
