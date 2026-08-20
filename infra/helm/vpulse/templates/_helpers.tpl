{{- define "vpulse.name" -}}vpulse{{- end }}
{{- define "vpulse.labels" -}}
app.kubernetes.io/name: {{ include "vpulse.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}
