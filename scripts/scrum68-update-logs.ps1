$ErrorActionPreference = "Stop"

$serviceFiles = @(
    @{ Path = "services\api-service\cmd\main.go"; Service = "api-service" },
    @{ Path = "services\worker-service\cmd\main.go"; Service = "worker-service" },
    @{ Path = "services\validation-service\cmd\main.go"; Service = "validation-service" },
    @{ Path = "services\exam-service\cmd\main.go"; Service = "exam-service" }
)

$newLogger = @'
func logKV(level, service, msg string, keyvals ...any) {
	fields := map[string]any{
		"timestamp": time.Now().UTC().Format(time.RFC3339),
		"level":     strings.ToUpper(level),
		"service":   service,
		"message":   msg,
	}

	for i := 0; i+1 < len(keyvals); i += 2 {
		key := strings.TrimSpace(fmt.Sprint(keyvals[i]))
		if key == "" {
			continue
		}
		fields[key] = keyvals[i+1]
	}

	encoded, err := json.Marshal(fields)
	if err != nil {
		log.Printf(`{"timestamp":%q,"level":"ERROR","service":%q,"message":"log serialization failed","error":%q}`, time.Now().UTC().Format(time.RFC3339), service, err.Error())
		return
	}

	log.Println(string(encoded))
}
'@

foreach ($item in $serviceFiles) {
    $path = $item.Path
    $content = Get-Content $path -Raw

    $content = $content -replace '(?m)^\s+"sort"\r?\n', ''
    $content = $content -replace '(?m)^\s+"strconv"\r?\n', ''

    $content = [regex]::Replace(
        $content,
        '(?s)func logKV\(level, service, msg string, keyvals \.\.\.any\) \{.*\z',
        $newLogger
    )

    Set-Content -Path $path -Value $content -NoNewline
}

function Replace-InFile {
    param (
        [string]$Path,
        [string]$Old,
        [string]$New
    )

    $content = Get-Content $Path -Raw
    $content = $content.Replace($Old, $New)
    Set-Content -Path $Path -Value $content -NoNewline
}

$apiServerStop = @'
if err := http.ListenAndServe(":"+port, handler); err != nil {
	logKV("error", "api-service", "http server stopped", "error", err.Error())
	os.Exit(1)
}
'@

$validationServerStop = @'
if err := http.ListenAndServe(":"+port, handler); err != nil {
	logKV("error", "validation-service", "http server stopped", "error", err.Error())
	os.Exit(1)
}
'@

$examServerStop = @'
if err := http.ListenAndServe(":"+port, handler); err != nil {
	logKV("error", "exam-service", "http server stopped", "error", err.Error())
	os.Exit(1)
}
'@

Replace-InFile `
    -Path "services\api-service\cmd\main.go" `
    -Old 'log.Fatal(http.ListenAndServe(":"+port, handler))' `
    -New $apiServerStop

Replace-InFile `
    -Path "services\validation-service\cmd\main.go" `
    -Old 'log.Printf("service=%q msg=%q port=%q", "validation-service", "listening", port)' `
    -New 'logKV("info", "validation-service", "listening", "port", port)'

Replace-InFile `
    -Path "services\validation-service\cmd\main.go" `
    -Old 'log.Fatal(http.ListenAndServe(":"+port, handler))' `
    -New $validationServerStop

Replace-InFile `
    -Path "services\validation-service\cmd\main.go" `
    -Old 'log.Printf("validation_result=%s document_id=%s", result.Status, result.DocumentID)' `
    -New 'logKV("info", "validation-service", "validation completed", "validation_result", result.Status, "document_id", result.DocumentID)'

Replace-InFile `
    -Path "services\exam-service\cmd\main.go" `
    -Old 'log.Printf("service=%q msg=%q port=%q", "exam-service", "listening", port)' `
    -New 'logKV("info", "exam-service", "listening", "port", port)'

Replace-InFile `
    -Path "services\exam-service\cmd\main.go" `
    -Old 'log.Fatal(http.ListenAndServe(":"+port, handler))' `
    -New $examServerStop

Replace-InFile `
    -Path "services\worker-service\cmd\main.go" `
    -Old 'log.Fatal("worker-service failed to start")' `
    -New 'os.Exit(1)'

Replace-InFile `
    -Path "services\worker-service\cmd\main.go" `
    -Old 'log.Fatal("worker-service stopped")' `
    -New 'os.Exit(1)'

Write-Host "SCRUM-68 logging format update completed."