param([ValidateSet('protect','unprotect')][string]$Action)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
try {
    $inputBytes = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())
    if ($Action -eq 'protect') {
        if ($inputBytes.Length -ne 32) { throw 'Invalid key' }
        $result = [Security.Cryptography.ProtectedData]::Protect($inputBytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    } else {
        $result = [Security.Cryptography.ProtectedData]::Unprotect($inputBytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
        if ($result.Length -ne 32) { throw 'Invalid key' }
    }
    [Console]::Out.Write([Convert]::ToBase64String($result))
} catch {
    [Console]::Error.Write('Windows recovery key protection failed.')
    exit 1
} finally {
    if ($inputBytes) { [Array]::Clear($inputBytes, 0, $inputBytes.Length) }
    if ($result) { [Array]::Clear($result, 0, $result.Length) }
}
