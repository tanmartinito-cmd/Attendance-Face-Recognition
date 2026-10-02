import React from 'react';
import AttendanceRoster from './AttendanceRoster';
import ScannerCameraPanel from './ScannerCameraPanel';

export default function ScannerShell(props) {
  return <div className="page-content"><div className="live-attendance-grid"><ScannerCameraPanel session={props.session} videoRef={props.videoRef} overlayCanvasRef={props.overlayCanvasRef} captureCanvasRef={props.captureCanvasRef} isCameraActive={props.isCameraActive} isPaused={props.isPaused} statusText={props.statusText} statusColor={props.statusColor} onStartCamera={props.onStartCamera} onStopCamera={props.onStopCamera} onTogglePause={props.onTogglePause} onSwitchCamera={props.onSwitchCamera} canSwitchCamera={props.canSwitchCamera} facingMode={props.facingMode} onReopenSession={props.onReopenSession} /><AttendanceRoster records={props.records} filteredRecords={props.filteredRecords} loading={props.loading} searchQuery={props.searchQuery} onSearchChange={props.onSearchChange} justMarkedId={props.justMarkedId} presentCount={props.presentCount} lateCount={props.lateCount} onManualMark={props.onManualMark} /></div></div>;
}
