term:
	zellij --layout term.kdl attach nexus-app -cf

term-kill:
	zellij delete-session nexus-app -f

open-browser:
	open http://localhost:8001
